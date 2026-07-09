import path from 'path'
import fs from 'fs/promises'

import {
  discoverFetch,
  getFetchRecordings,
  downloadFile,
  isCurrentlyRecording,
  createValidFilename,
} from 'fetchtv'

import { db, getSetting } from './db.js'
import { notifyPlexSectionRefresh } from './plex.js'
import { deleteRecordings as deleteCloudRecordings, FetchCloudError } from './fetch-cloud.js'
import { processRecordingAds, pruneCutOriginals, shouldQueueAutoDelete } from './commercials.js'
import { makeDownloadProgress } from './progress.js'

export const getActiveSyncId = () => inFlight?.syncId ?? null

export const awaitSync = async () => {
  if (inFlight) return inFlight.promise
}

export const startSync = async ({ trigger = 'manual', showId = null } = {}) => {
  if (inFlight) return { syncId: inFlight.syncId, alreadyRunning: true }

  const syncId = await createSync(trigger, showId)
  const promise = doSync({ syncId, trigger, showId })
    .catch((err) => {
      console.error('[sync] unhandled error:', err)
    })
    .finally(() => {
      inFlight = null
    })
  inFlight = { syncId, promise }
  return { syncId, alreadyRunning: false }
}

export const matchShow = (shows, showTitle) => {
  const t = showTitle.toLowerCase()
  return shows.find((s) => t.includes(s.fetch_show_pattern.toLowerCase()))
}

export const classifyOutcome = ({
  downloadResult,
  expectedSize,
  actualSize,
  tolerance = SIZE_TRUNCATION_TOLERANCE_BYTES,
}) => {
  if (downloadResult.recorded) {
    const expectedKnown = Number.isFinite(expectedSize) && expectedSize > 0
    const actualKnown = Number.isFinite(actualSize) && actualSize >= 0
    const shortfall = expectedKnown && actualKnown ? expectedSize - actualSize : 0

    if (shortfall > tolerance) {
      return {
        dbStatus: 'partial',
        summaryKey: 'failed',
        sizeToStore: actualSize,
        markDownloadedAt: true,
        error: `truncated: on-disk ${actualSize} bytes vs Fetch ${expectedSize} bytes`
          + ` (Δ ${shortfall})`,
      }
    }

    return {
      dbStatus: 'done',
      summaryKey: 'downloaded',
      sizeToStore: actualKnown ? actualSize : expectedSize,
      markDownloadedAt: true,
      error: null,
    }
  }

  return {
    dbStatus: downloadResult.error ? 'failed' : 'partial',
    summaryKey: downloadResult.error ? 'failed' : 'skipped',
    sizeToStore: null,
    markDownloadedAt: false,
    error: downloadResult.error || downloadResult.warning || null,
  }
}

export const getMediaRoot = async () => {
  const fromSetting = await getSetting('media_root')
  if (fromSetting && fromSetting.trim()) return fromSetting.trim()
  return process.env.MEDIA_ROOT || DEFAULT_MEDIA_ROOT
}

export const buildDestPath = ({ item, show, mediaRoot }) => {
  const seasonPadded = item.season_number_padded || '00'
  const seasonRaw = item.season_number || '0'
  const seasonDir = (show.season_template || 'Season {season}')
    .replaceAll('{season}', seasonPadded)
    .replaceAll('{season_padded}', seasonPadded)
    .replaceAll('{season_unpadded}', seasonRaw)
  const fileName = `${createValidFilename(item.title)}.${item.ext || 'ts'}`
  return path.join(mediaRoot, show.dest_folder, seasonDir, fileName)
}

const doSync = async ({ syncId, trigger, showId = null }) => {
  const summary = { trigger, downloaded: 0, skipped: 0, failed: 0, errors: [] }
  if (showId != null) summary.showId = showId
  const deletables = []
  const mediaRoot = await getMediaRoot()

  let ip, port, shows, fetchServer
  try {
    shows = await db('shows').where({ enabled: true })
    if (showId != null) {
      shows = shows.filter((s) => s.id === showId)
      if (shows.length === 0) {
        summary.message = `show_id ${showId} not found or not enabled`
        await finishSync(syncId, 'error', summary)
        return
      }
    }
    if (shows.length === 0) {
      summary.message = 'no active shows'
      await finishSync(syncId, 'ok', summary)
      return
    }

    ip = await getSetting('fetch_ip')
    port = Number((await getSetting('fetch_port')) || DEFAULT_FETCH_PORT)
    if (!ip) throw new Error('fetch_ip not configured')

    fetchServer = await discoverFetch({ ip, port })
    if (!fetchServer) throw new Error(`could not reach Fetch TV at ${ip}:${port}`)
  } catch (err) {
    summary.errors.push(err.message)
    await finishSync(syncId, 'error', summary)
    return
  }

  let recordings
  try {
    const folderFilter = shows.map((s) => s.fetch_show_pattern.toLowerCase())
    recordings = await getFetchRecordings({
      location: fetchServer,
      filters: {
        folderFilter,
        excludeFilter: [],
        titleFilter: [],
        showsOnly: false,
        isRecordingFilter: false,
      },
    })
  } catch (err) {
    summary.errors.push(`browse failed: ${err.message}`)
    await finishSync(syncId, 'error', summary)
    return
  }

  for (const fetchShow of recordings) {
    const show = matchShow(shows, fetchShow.title)
    if (!show) continue

    for (const item of fetchShow.items || []) {
      try {
        const { summaryKey, adResult } = await processItem({ item, show, mediaRoot })
        summary[summaryKey]++
        if (adResult) accumulateAdSummary(summary, adResult)
        if (
          summaryKey === 'downloaded'
          && show.delete_after_download
          && shouldQueueAutoDelete({ show, adResult })
        ) {
          deletables.push({ fetch_id: String(item.id), fetch_title: item.title })
        }
      } catch (err) {
        summary.failed++
        summary.errors.push(`${item.title}: ${err.message}`)
      }
    }
  }

  if (summary.downloaded > 0) summary.plex = await notifyPlexSectionRefresh()
  if (deletables.length > 0) summary.delete = await runAutoDelete(deletables, summary.plex)

  const finalStatus = summary.failed > 0 ? 'partial' : 'ok'
  await finishSync(syncId, finalStatus, summary)
}

const processItem = async ({ item, show, mediaRoot }) => {
  const existing = await db('recordings').where({ fetch_id: String(item.id) }).first()
  if (existing?.status === 'done') return { summaryKey: 'skipped' }
  if (existing?.deleted_from_fetch_at) return { summaryKey: 'skipped' }

  if (await isCurrentlyRecording(item)) {
    const recoveredSize = item.size === FETCH_DLNA_STALE_SENTINEL
      ? await probeFinalizedSize(item.url)
      : null
    if (recoveredSize) {
      console.log(
        `[sync] ${item.title}: DLNA stale (size=-1) but HEAD shows ${recoveredSize} bytes; `
        + `treating as finalized`
      )
      item.size = recoveredSize
    } else {
      await upsertRecording({
        item,
        show,
        file_path: null,
        status: 'skipped',
        error: 'currently recording',
      })
      return { summaryKey: 'skipped' }
    }
  }

  const filePath = buildDestPath({ item, show, mediaRoot })
  await upsertRecording({
    item,
    show,
    file_path: filePath,
    status: 'downloading',
    error: null,
  })

  await fs.mkdir(path.dirname(filePath), { recursive: true })

  const result = await downloadFile({
    item,
    filePath,
    progressBar: makeDownloadProgress(String(item.id)),
    overwrite: false,
  })

  let actualSize = null
  if (result.recorded) {
    try {
      const stat = await fs.stat(filePath)
      actualSize = stat.size
    } catch {
      actualSize = null
    }
  }

  const outcome = classifyOutcome({
    downloadResult: result,
    expectedSize: item.size,
    actualSize,
  })

  const update = { status: outcome.dbStatus, error: outcome.error }
  if (outcome.sizeToStore != null) update.size = outcome.sizeToStore
  if (outcome.markDownloadedAt) update.downloaded_at = db.fn.now()
  await db('recordings').where({ fetch_id: String(item.id) }).update(update)

  let adResult = null
  if (outcome.dbStatus === 'done' && show.ad_removal !== 'off') {
    const adRemovalEnabled = (await getSetting('ad_removal_enabled')) === 'true'
    if (adRemovalEnabled) {
      adResult = await processRecordingAds({
        filePath,
        mode: show.ad_removal,
        fetchId: String(item.id),
      })
    }
  }
  return { summaryKey: outcome.summaryKey, adResult }
}

const accumulateAdSummary = (summary, adResult) => {
  if (!summary.ads) summary.ads = { scanned: 0, detected: 0, cut: 0, failed: 0, adSeconds: 0 }
  summary.ads.scanned++
  if (adResult.status === 'detected') summary.ads.detected++
  if (adResult.status === 'cut') summary.ads.cut++
  if (adResult.status === 'detect_failed' || adResult.status === 'cut_failed') summary.ads.failed++
  summary.ads.adSeconds += adResult.adSeconds
}

const runAutoDelete = async (deletables, plex) => {
  const fetchIds = deletables.map((d) => d.fetch_id)

  const guardSettingRaw = (await getSetting('delete_after_plex_refresh_only')) ?? 'true'
  const guardOn = guardSettingRaw !== 'false'
  const plexAttemptedAndFailed = guardOn && plex && !plex.triggered
  const plexUnconfigured = plex?.skipped && plex?.reason === 'plex not configured'
  if (plexAttemptedAndFailed && !plexUnconfigured) {
    return {
      skipped: true,
      reason: `plex refresh did not succeed (${plex.error || plex.reason || 'unknown'})`,
      candidates: fetchIds.length,
    }
  }

  try {
    const result = await deleteCloudRecordings({ recordingIds: fetchIds })
    const now = new Date().toISOString()
    await db('recordings').whereIn('fetch_id', fetchIds).update({ deleted_from_fetch_at: now })
    return {
      triggered: true,
      deleted: fetchIds,
      unmapped: result.unmappedDlnaIds || [],
      deleted_at: now,
    }
  } catch (err) {
    const stage = err instanceof FetchCloudError ? err.stage : 'unknown'
    const code = err instanceof FetchCloudError ? err.code : undefined
    return { error: err.message, stage, code, candidates: fetchIds.length }
  }
}

const createSync = async (trigger, showId = null) => {
  const seed = { trigger }
  if (showId != null) seed.showId = showId
  const inserted = await db('syncs').insert({
    status: 'running',
    summary_json: JSON.stringify(seed),
  }).returning('id')
  const row = inserted[0]
  return typeof row === 'object' ? row.id : row
}

const finishSync = async (syncId, status, summary) => {
  await db('syncs').where({ id: syncId }).update({
    status,
    finished_at: db.fn.now(),
    summary_json: JSON.stringify(summary),
  })
  await pruneSyncHistory()
  await pruneTombstonedRecordings()
  await pruneCutOriginals()
}

const pruneTombstonedRecordings = async () => {
  await db('recordings')
    .whereNotNull('deleted_from_fetch_at')
    .andWhereRaw(
      `datetime(deleted_from_fetch_at) < datetime('now', '-${RECORDING_TOMBSTONE_TTL_DAYS} days')`
    )
    .delete()
}

const pruneSyncHistory = async () => {
  const keep = await db('syncs')
    .select('id')
    .orderBy('started_at', 'desc')
    .limit(SYNC_HISTORY_CAP)
  const keepIds = keep.map((r) => r.id)
  if (keepIds.length < SYNC_HISTORY_CAP) return
  await db('syncs')
    .whereNotIn('id', keepIds)
    .andWhere('status', '!=', 'running')
    .delete()
}

const probeFinalizedSize = async (url) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), HEAD_PROBE_TIMEOUT_MS)
  try {
    const res = await fetch(url, { method: 'HEAD', signal: controller.signal })
    if (!res.ok) return null
    const len = Number(res.headers.get('content-length'))
    if (!Number.isFinite(len) || len <= 0) return null
    if (len === FETCH_RECORDING_MARKER_BYTES) return null
    return len
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

const upsertRecording = async ({ item, show, file_path, status, error }) => {
  const payload = {
    fetch_id: String(item.id),
    show_id: show.id,
    fetch_title: item.title,
    season: item.season_number ? Number(item.season_number) : null,
    episode: item.episode_number ? Number(item.episode_number) : null,
    file_path,
    size: item.size > 0 ? item.size : null,
    status,
    error,
  }
  const { fetch_id, ...mergeable } = payload
  await db('recordings')
    .insert(payload)
    .onConflict('fetch_id')
    .merge(mergeable)
}

const DEFAULT_MEDIA_ROOT = '/media/tv'
const DEFAULT_FETCH_PORT = 49152

// If on-disk file is more than this many bytes smaller than Fetch's reported size,
// treat as a truncated capture of a still-recording item (Fetch occasionally reports
// stable-looking sizes for recordings still being written).
const SIZE_TRUNCATION_TOLERANCE_BYTES = 1_000_000

const FETCH_DLNA_STALE_SENTINEL = -1
const FETCH_RECORDING_MARKER_BYTES = 4398046510080
const HEAD_PROBE_TIMEOUT_MS = 10_000

const SYNC_HISTORY_CAP = 500
const RECORDING_TOMBSTONE_TTL_DAYS = 30

let inFlight = null
