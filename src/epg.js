import axios from 'axios'

import { getSetting } from './db.js'
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
  return {
    day,
    dayStart,
    dayEnd,
    fetchedAt: guide.fetchedAt,
    channels: await withHiddenFlags(guide.channels),
    programs,
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
  const value = {
    standby: state.standby,
    storageInfo: state.storageInfo,
    tunerCount: state.sysInfo?.hardwareCapabilities?.tuner?.tunersAvailable ?? null,
    maxConcurrentRecordings:
      state.sysInfo?.hardwareCapabilities?.tuner?.maximumRecordingCount ?? null,
    futureRecordings: state.futureRecordings,
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

// Channel logos live on static.fetchtv.com.au, which the browser CSP blocks —
// proxied here with an in-memory cache instead of widening img-src.
export const getChannelLogo = async ({ channelId } = {}) => {
  const cached = logoCache.get(channelId)
  if (cached && cached.expiresAt > Date.now()) return cached.value
  const guide = await getCachedGuide()
  const channel = guide.channels.find((c) => String(c.id) === String(channelId))
  if (!channel?.image) return null
  const url = channel.image.startsWith('http')
    ? channel.image
    : `${URL_STATIC_BASE}${channel.image.startsWith('/') ? '' : '/'}${channel.image}`
  const res = await axios.get(url, { responseType: 'arraybuffer', timeout: LOGO_TIMEOUT_MS })
  const value = {
    body: Buffer.from(res.data),
    contentType: res.headers['content-type'] || 'image/png',
  }
  logoCache.set(channelId, { value, expiresAt: Date.now() + LOGO_TTL_MS })
  return value
}

// Merges the box's channel lineup (authoritative ids + order) with the cloud
// channel directory (names, HD flag, logo paths) on epg_id.
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
        name: c.name || cloud.name || '',
        description: c.description || cloud.description || '',
        hd: Boolean(c.high_definition ?? cloud.high_definition),
        recordable: c.isRecordable !== false,
        image: c.image || cloud.image || '',
      }
    })
    .filter((c) => c.epgId != null)
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
    .finally(() => { guideInflight = null })
  return guideInflight
}

const loadGuide = async (startMs) => {
  const [{ channels: cloudChannels }, boxState] = await Promise.all([
    fetchEpgChannels(),
    getBoxState(),
  ])
  const channels = mergeChannels({ dvbChannels: boxState.dvbChannels, cloudChannels })
  if (channels.length === 0) {
    throw new FetchCloudError(
      'Box returned no channel lineup — is the terminal a PVR and online?',
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

const withHiddenFlags = async (channels) => {
  const raw = await getSetting('epg_hidden_channels')
  let hidden = []
  try { hidden = JSON.parse(raw || '[]') } catch { hidden = [] }
  const hiddenSet = new Set(hidden.map(String))
  return channels.map((c) => ({ ...c, hidden: hiddenSet.has(String(c.id)) }))
}

let guideCache = null
let guideInflight = null
let stateCache = null
const logoCache = new Map()

const URL_STATIC_BASE = 'https://static.fetchtv.com.au'
const DAY_MS = 24 * 60 * 60 * 1000
const GUIDE_BLOCKS = 42
const GUIDE_TTL_MS = 60 * 60 * 1000
const STATE_TTL_MS = 45 * 1000
const LOGO_TTL_MS = 24 * 60 * 60 * 1000
const LOGO_TIMEOUT_MS = 10000
const SEARCH_RESULT_CAP = 100
