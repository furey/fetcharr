import axios from 'axios'

import { getSetting, setSetting } from './db.js'
import {
  fetchEpgChannels,
  fetchEpgPrograms,
  getBoxState,
  scheduleRecording,
  cancelRecording,
  enableSeriesTag,
  disableSeriesTag,
  FetchCloudError,
} from './fetch-cloud.js'

export const getGuideDay = async ({ day = 0 } = {}) => {
  const guide = await getCachedGuide()
  const dayStart = guide.startMs + day * DAY_MS
  const dayEnd = dayStart + DAY_MS
  const programs = {}
  for (const channel of guide.channels) {
    const rows = guide.programsByChannel[String(channel.epgId)] || []
    programs[channel.id] = rows.filter((p) => p.start < dayEnd && p.end > dayStart)
  }
  const prefs = await getChannelPrefs()
  return {
    day,
    dayStart,
    dayEnd,
    fetchedAt: guide.fetchedAt,
    stale: Boolean(guide.stale),
    sort: prefs.sort,
    channels: orderChannels({ channels: guide.channels, ...prefs }),
    programs,
  }
}

// Pinned channels float to the top in pin order; the rest follow in the chosen
// sort. Hidden and pinned are mutually exclusive (enforced on save).
export const orderChannels = ({ channels, pinnedIds = [], hiddenIds = [], sort = 'default' }) => {
  const hiddenSet = new Set(hiddenIds.map(String))
  const pinOrder = new Map(pinnedIds.map((id, i) => [String(id), i]))
  const annotated = channels.map((c) => {
    const pinned = pinOrder.has(String(c.id))
    return { ...c, pinned, hidden: !pinned && hiddenSet.has(String(c.id)) }
  })
  const pinned = annotated
    .filter((c) => c.pinned)
    .sort((a, b) => pinOrder.get(String(a.id)) - pinOrder.get(String(b.id)))
  const rest = annotated.filter((c) => !c.pinned)
  if (sort === 'name') {
    rest.sort((a, b) => a.name.localeCompare(b.name, 'en-AU', { numeric: true, sensitivity: 'base' }))
  } else if (sort === 'number') {
    rest.sort((a, b) => (a.number ?? Infinity) - (b.number ?? Infinity))
  }
  return [...pinned, ...rest]
}

export const getChannelPrefs = async () => {
  const [pinnedRaw, hiddenRaw, sortRaw] = await Promise.all([
    getSetting('epg_pinned_channels'),
    getSetting('epg_hidden_channels'),
    getSetting('epg_channel_sort'),
  ])
  return {
    pinnedIds: parseJsonArray(pinnedRaw),
    hiddenIds: parseJsonArray(hiddenRaw),
    sort: CHANNEL_SORTS.includes(sortRaw) ? sortRaw : 'default',
  }
}

// Partial update; pinning a channel unhides it, hiding one unpins it.
export const setChannelPrefs = async ({ pinnedIds, hiddenIds, sort } = {}) => {
  const current = await getChannelPrefs()
  const next = {
    pinnedIds: pinnedIds ?? current.pinnedIds,
    hiddenIds: hiddenIds ?? current.hiddenIds,
    sort: sort ?? current.sort,
  }
  if (!CHANNEL_SORTS.includes(next.sort)) next.sort = 'default'
  const pinnedSet = new Set(next.pinnedIds.map(String))
  next.hiddenIds = next.hiddenIds.map(String).filter((id) => !pinnedSet.has(id))
  next.pinnedIds = next.pinnedIds.map(String)
  await Promise.all([
    setSetting('epg_pinned_channels', JSON.stringify(next.pinnedIds)),
    setSetting('epg_hidden_channels', JSON.stringify(next.hiddenIds)),
    setSetting('epg_channel_sort', next.sort),
  ])
  return next
}

// On-now / up-next for the pinned channels, served from the guide cache — the
// dashboard's TV Guide panel.
export const getOnNowForPinned = async ({ nowMs = Date.now() } = {}) => {
  const guide = await getCachedGuide()
  const { pinnedIds } = await getChannelPrefs()
  const byId = new Map(guide.channels.map((c) => [String(c.id), c]))
  const entries = []
  for (const id of pinnedIds) {
    const channel = byId.get(String(id))
    if (!channel) continue
    const rows = guide.programsByChannel[String(channel.epgId)] || []
    const { now, next } = nowAndNext(rows, nowMs)
    entries.push({
      channel: {
        id: channel.id,
        name: channel.name,
        number: channel.number ?? null,
        hasLogo: Boolean(channel.logo),
      },
      now,
      next,
    })
  }
  return { entries }
}

export const nowAndNext = (programs, nowMs) => {
  let now = null
  let next = null
  for (const p of programs) {
    if (p.start <= nowMs && p.end > nowMs) now = p
    else if (p.start > nowMs && (!next || p.start < next.start)) next = p
  }
  return { now: trimProgram(now), next: trimProgram(next) }
}

// The box only materialises a timer (currentFutureRecordings) shortly before an
// episode airs, so a series set for tomorrow shows nothing there yet. Project
// the next episodes from each series tag against the loaded guide and merge them
// with the real timers, so the Upcoming view reflects what will actually record.
// A projected entry is source:'series' (expected); a real timer is source:'timer'.
export const projectUpcomingRecordings = ({ seriesTags = [], futureRecordings = [], guide, nowMs = Date.now() } = {}) => {
  const timers = futureRecordings
    .filter((r) => !r.pendingDelete)
    .map((r) => ({
      programId: r.programId,
      name: r.name,
      channelId: r.channelId,
      channelName: r.channelName || null,
      startDate: r.startDate,
      endDate: r.endDate,
      episodeTitle: r.episodeTitle || null,
      seriesLinkId: r.seriesLinkId || null,
      source: 'timer',
    }))
  const timerProgramIds = new Set(timers.map((t) => String(t.programId)))

  const projected = []
  if (guide?.channels?.length) {
    const tagByLink = new Map()
    for (const t of seriesTags) {
      const link = t?.seriesLinkId ?? t?.id
      if (link != null) tagByLink.set(String(link), t)
    }
    const seenEpisode = new Set()
    for (const channel of guide.channels) {
      const rows = [...(guide.programsByChannel?.[String(channel.epgId)] || [])]
        .sort((a, b) => a.start - b.start)
      for (const p of rows) {
        if (p.start <= nowMs || p.series_link == null) continue
        const tag = tagByLink.get(String(p.series_link))
        if (!tag || String(tag.channelId) !== String(channel.id)) continue
        if (timerProgramIds.has(String(p.program_id))) continue
        if (p.series_no != null && p.episode_no != null) {
          const key = `${p.series_link}|${p.series_no}x${p.episode_no}`
          if (seenEpisode.has(key)) continue
          seenEpisode.add(key)
        }
        projected.push({
          programId: p.program_id,
          name: p.title,
          channelId: channel.id,
          channelName: channel.name || null,
          startDate: p.start,
          endDate: p.end,
          episodeTitle: p.episode_title || null,
          seriesLinkId: p.series_link,
          seriesNo: p.series_no ?? null,
          episodeNo: p.episode_no ?? null,
          source: 'series',
        })
      }
    }
  }

  return [...timers, ...projected].sort((a, b) => a.startDate - b.startDate)
}

const trimProgram = (p) => p == null ? null : {
  program_id: p.program_id,
  epg_program_id: p.epg_program_id,
  title: p.title,
  episode_title: p.episode_title || null,
  start: p.start,
  end: p.end,
  series_link: p.series_link || null,
}

const parseJsonArray = (raw) => {
  try {
    const parsed = JSON.parse(raw || '[]')
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

export const searchGuide = async ({ q } = {}) => {
  const needle = (q || '').trim().toLowerCase()
  if (needle.length < 2) return { results: [] }
  const guide = await getCachedGuide()
  const nowMs = Date.now()
  const results = []
  for (const channel of guide.channels) {
    const rows = guide.programsByChannel[String(channel.epgId)] || []
    for (const p of rows) {
      if (p.end <= nowMs) continue
      const haystack = `${p.title || ''} ${p.episode_title || ''}`.toLowerCase()
      if (!haystack.includes(needle)) continue
      results.push({ ...p, channelId: channel.id, channelName: channel.name })
      if (results.length >= SEARCH_RESULT_CAP) break
    }
    if (results.length >= SEARCH_RESULT_CAP) break
  }
  results.sort((a, b) => a.start - b.start)
  return { results }
}

export const getRecordingState = async ({ fresh = false } = {}) => {
  const now = Date.now()
  if (!fresh && stateCache && stateCache.expiresAt > now) return stateCache.value
  const state = await getBoxState()
  const guide = await getCachedGuide().catch(() => null)
  const upcomingRecordings = projectUpcomingRecordings({
    seriesTags: state.seriesTags,
    futureRecordings: state.futureRecordings,
    guide,
    nowMs: now,
  })
  const value = {
    standby: state.standby,
    storageInfo: state.storageInfo,
    tunerCount: state.sysInfo?.hardwareCapabilities?.tuner?.tunersAvailable ?? null,
    maxConcurrentRecordings:
      state.sysInfo?.hardwareCapabilities?.tuner?.maximumRecordingCount ?? null,
    futureRecordings: state.futureRecordings,
    upcomingRecordings,
    seriesTags: state.seriesTags,
    activeRecordingIds: state.activeRecordingIds,
    fetchedAt: now,
  }
  stateCache = { value, expiresAt: now + STATE_TTL_MS }
  return value
}

export const invalidateRecordingState = () => { stateCache = null }

export const recordProgram = async (args) => {
  const result = await scheduleRecording(args)
  invalidateRecordingState()
  return result
}

export const cancelProgram = async (args) => {
  const result = await cancelRecording(args)
  invalidateRecordingState()
  return result
}

export const recordSeries = async (args) => {
  const result = await enableSeriesTag(args)
  invalidateRecordingState()
  return result
}

export const cancelSeries = async (args) => {
  const result = await disableSeriesTag(args)
  invalidateRecordingState()
  return result
}

// Channel imagery lives on static(.lb.i).fetchtv.com.au, which the browser CSP
// blocks — proxied here with an in-memory cache instead of widening img-src.
// kind 'logo' is the EPG rail logo; 'thumb' is the landscape channel artwork
// used in the programme detail modal (the EPG carries no per-programme images).
export const getChannelImage = async ({ channelId, kind = 'logo' } = {}) => {
  const cacheKey = `${kind}:${channelId}`
  const cached = imageCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.value
  const guide = await getCachedGuide()
  const channel = guide.channels.find((c) => String(c.id) === String(channelId))
  const url = kind === 'thumb' ? channel?.thumb : channel?.logo
  if (!url) return null
  const res = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: IMAGE_TIMEOUT_MS,
    validateStatus: () => true,
  })
  if (res.status >= 400) return null
  const value = {
    body: Buffer.from(res.data),
    contentType: res.headers['content-type'] || 'image/png',
  }
  imageCache.set(cacheKey, { value, expiresAt: Date.now() + IMAGE_TTL_MS })
  return value
}

// Merges the box's channel lineup (authoritative ids + order) with the cloud
// channel directory (names, LCN, HD flag, imagery) on epg_id.
export const mergeChannels = ({ dvbChannels, cloudChannels }) => {
  const byEpgId = new Map()
  for (const [id, c] of Object.entries(cloudChannels || {})) {
    if (c?.epg_id != null) byEpgId.set(String(c.epg_id), { cloudId: id, ...c })
  }
  return (dvbChannels || [])
    .filter((c) => c?.isVideo !== false && !c?.isAudio)
    .map((c) => {
      const cloud = byEpgId.get(String(c.epg_id)) || {}
      return {
        id: c.id,
        epgId: c.epg_id,
        number: cloud.number ?? c.number ?? null,
        name: c.name || cloud.name || '',
        description: c.description || cloud.description || '',
        hd: Boolean(c.high_definition ?? cloud.high_definition),
        recordable: c.isRecordable !== false,
        logo: pickImage(cloud.images, LOGO_IMAGE_KEYS),
        thumb: pickImage(cloud.images, THUMB_IMAGE_KEYS),
      }
    })
    .filter((c) => c.epgId != null)
}

// Fetch names an HD simulcast and its SD sibling identically (Sydney has two
// channels called "7", LCN 70 and 71) — no HD flag exists anywhere in the
// cloud directory, the DVB lineup, or the programme flags. Australian DVB
// convention puts the HD primary on the x0 LCN, so when a name collides and
// exactly one of the group sits on an x0 number, label that one HD.
export const labelHdSimulcasts = (channels) => {
  const byName = new Map()
  for (const c of channels) {
    const key = (c.name || '').trim().toLowerCase()
    if (!key) continue
    if (!byName.has(key)) byName.set(key, [])
    byName.get(key).push(c)
  }
  for (const group of byName.values()) {
    if (group.length < 2) continue
    const onZero = group.filter((c) => c.number != null && c.number % 10 === 0)
    if (onZero.length !== 1) continue
    onZero[0].name = `${onZero[0].name} HD`
    onZero[0].hd = true
  }
  return channels
}

// The box can list the same service twice (identical epg_id, DVB ids differing
// only by a source prefix); keep the first occurrence in box order.
export const dedupeByEpgId = (channels) => {
  const seen = new Set()
  return channels.filter((c) => {
    const key = String(c.epgId)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// Image `original` URLs point at static.lb.i.fetchtv.com.au, which is internal
// to Fetch and unreachable from the LAN — only the public CDN resizer preset
// URLs (static.fetchtv.com.au/v4/images/…) actually resolve. Pick the largest
// preset by the WxH encoded in its name; fall back to the original only when it
// is already on the public host.
const pickImage = (images, keys) => {
  for (const key of keys) {
    const entry = images?.[key]
    if (!entry) continue
    const presets = Object.entries(entry.presets || {})
    if (presets.length > 0) {
      presets.sort(([a], [b]) => presetArea(b) - presetArea(a))
      return presets[0][1]
    }
    if (entry.original && !entry.original.includes('.lb.i.')) return entry.original
  }
  return ''
}

const presetArea = (name) => {
  const m = name.match(/(\d+)x(\d+)/)
  return m ? Number(m[1]) * Number(m[2]) : 0
}

export const localMidnightMs = (now = new Date()) => {
  const midnight = new Date(now)
  midnight.setHours(0, 0, 0, 0)
  return midnight.getTime()
}

const getCachedGuide = async () => {
  const now = Date.now()
  const startMs = localMidnightMs()
  if (guideCache && guideCache.startMs === startMs && guideCache.expiresAt > now) {
    return guideCache
  }
  if (guideInflight) return guideInflight
  guideInflight = loadGuide(startMs)
    .then((guide) => {
      guideCache = guide
      return guide
    })
    .catch((err) => {
      if (guideCache && guideCache.startMs === startMs) {
        guideCache = { ...guideCache, stale: true, expiresAt: Date.now() + GUIDE_STALE_RETRY_MS }
        return guideCache
      }
      throw err
    })
    .finally(() => { guideInflight = null })
  return guideInflight
}

// The channel lineup (box DVB channel ids, region-correct) only comes from the
// box's I_AM_ALIVE dump, but the box's cloud session sleeps. The last good
// lineup is persisted so the guide keeps working while the box is unreachable —
// only schedule/cancel commands truly need the box awake.
const loadGuide = async (startMs) => {
  const [{ channels: cloudChannels }, boxState] = await Promise.all([
    fetchEpgChannels(),
    getBoxState().catch(() => null),
  ])
  let channels = boxState
    ? mergeChannels({ dvbChannels: boxState.dvbChannels, cloudChannels })
    : []
  if (channels.length > 0) {
    await setSetting('epg_channel_lineup', JSON.stringify(channels))
  } else {
    try { channels = JSON.parse(await getSetting('epg_channel_lineup') || '[]') } catch { channels = [] }
  }
  channels = labelHdSimulcasts(dedupeByEpgId(channels))
  if (channels.length === 0) {
    throw new FetchCloudError(
      "Could not read the box's channel lineup (box unreachable and no lineup cached yet)."
        + ' Wake the box, or open it in the Fetch mobile app, then retry.',
      { stage: 'epg', code: 'no-lineup' },
    )
  }
  const { programsByChannel } = await fetchEpgPrograms({
    channelIds: channels.map((c) => c.epgId),
    startMs,
    blockCount: GUIDE_BLOCKS,
  })
  return {
    startMs,
    channels,
    programsByChannel,
    fetchedAt: Date.now(),
    expiresAt: Date.now() + GUIDE_TTL_MS,
  }
}

let guideCache = null
let guideInflight = null
let stateCache = null
const imageCache = new Map()

const CHANNEL_SORTS = ['default', 'number', 'name']
const LOGO_IMAGE_KEYS = ['channel_logo_offstate', 'channel_logo_focus', 'drawer_channel_logo']
const THUMB_IMAGE_KEYS = ['landscape_thumbnail', 'phone_environment_image']
const DAY_MS = 24 * 60 * 60 * 1000
const GUIDE_BLOCKS = 42
const GUIDE_TTL_MS = 60 * 60 * 1000
const GUIDE_STALE_RETRY_MS = 60 * 1000
const STATE_TTL_MS = 45 * 1000
const IMAGE_TTL_MS = 24 * 60 * 60 * 1000
const IMAGE_TIMEOUT_MS = 10000
const SEARCH_RESULT_CAP = 100
