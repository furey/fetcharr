import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import express from 'express'
import helmet from 'helmet'
import cookieParser from 'cookie-parser'
import rateLimit from 'express-rate-limit'
import { doubleCsrf } from 'csrf-csrf'
import { discoverFetchServers, discoverFetch, getFetchRecordings } from 'fetchtv'

import { db, getSetting, setSetting } from './db.js'
import { matchShowFolder, listShowFolders } from './folder-matcher.js'
import { startSync, getActiveSyncId, getMediaRoot } from './sync.js'
import { startScheduler, getSchedulerExpression, stopScheduler } from './scheduler.js'
import {
  detectPlexTokenFromPreferences,
  listPlexSections,
  notifyPlexSectionRefresh,
  discoverLocalPlexServers,
  getPlexPrefsPath,
} from './plex.js'
import {
  testConnection as testFetchCloudConnection,
  deleteRecordings as deleteCloudRecordings,
  FetchCloudError,
} from './fetch-cloud.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const PORT = Number(process.env.PORT || 8124)
const DEV_CSRF_SECRET = 'dev-only-csrf-secret-set-CSRF_SECRET-in-prod'
const CSRF_SECRET = process.env.CSRF_SECRET || DEV_CSRF_SECRET
const DEFAULT_FETCH_PORT = 49152

if (process.env.NODE_ENV === 'production' && CSRF_SECRET === DEV_CSRF_SECRET) {
  console.error(
    '[server] CSRF_SECRET must be set when NODE_ENV=production. '
      + 'Generate one with `openssl rand -hex 32`.',
  )
  process.exit(1)
}
if (CSRF_SECRET.length < 32) {
  console.warn(`[server] CSRF_SECRET is only ${CSRF_SECRET.length} chars — use at least 32 bytes.`)
}

const app = express()
app.disable('x-powered-by')
app.set('trust proxy', 'loopback')

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        'default-src': ["'self'"],
        // Vue's in-browser template compiler uses Function() — needs 'unsafe-eval'.
        // To drop it, move to a build step (Vite) that pre-compiles templates.
        'script-src': ["'self'", "'unsafe-eval'"],
        'style-src': ["'self'", "'unsafe-inline'"],
        'img-src': ["'self'", 'data:'],
        'connect-src': ["'self'"],
        'object-src': ["'none'"],
        'base-uri': ["'self'"],
        'form-action': ["'self'"],
        'frame-ancestors': ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    // Disabled because fetcharr serves plain HTTP on the LAN. Enabling HSTS would
    // tell browsers to refuse HTTP for max-age=1y. Re-enable when fronted by TLS.
    hsts: false,
  }),
)

app.use((req, res, next) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow')
  next()
})

app.use(express.json())
app.use(express.urlencoded({ extended: false }))
app.use(cookieParser(CSRF_SECRET))

const { doubleCsrfProtection, generateToken } = doubleCsrf({
  getSecret: () => CSRF_SECRET,
  // Authless LAN service — no per-user session. req.ip flaps under Docker bridge
  // networking (different gateway between GET that mints and POST that validates),
  // which breaks CSRF in browsers while loopback curl still works.
  getSessionIdentifier: () => 'fetcharr',
  // `__Host-` prefix requires Secure (HTTPS). LAN deploy is HTTP-only for now.
  // Switch to `__Host-fetcharr.x-csrf` + secure:true when fronted by TLS.
  cookieName: 'fetcharr.x-csrf',
  cookieOptions: {
    httpOnly: true,
    sameSite: 'strict',
    secure: false,
    path: '/',
  },
  size: 32,
})

const syncLimiter = rateLimit({
  windowMs: 60_000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
})

app.get('/healthz', (req, res) => res.json({ ok: true }))

app.get('/api/csrf-token', (req, res) => {
  // overwrite=true forces a fresh token. Without it, csrf-csrf tries to reuse
  // any existing cookie value and throws 403 if validation fails (e.g. server
  // restarted with a new CSRF_SECRET, stale browser cookie).
  const token = generateToken(req, res, true)
  res.json({ token })
})

app.post('/api/sync', syncLimiter, doubleCsrfProtection, async (req, res) => {
  try {
    const showIdRaw = req.body?.show_id
    const showId = showIdRaw == null || showIdRaw === '' ? null : Number(showIdRaw)
    if (showId != null && !Number.isInteger(showId)) {
      return res.status(400).json({ error: 'show_id must be an integer' })
    }
    const result = await startSync({
      trigger: showId == null ? 'manual' : 'manual-single',
      showId,
    })
    res.status(result.alreadyRunning ? 200 : 202).json(result)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/sync-status', (req, res) => {
  res.json({
    activeSyncId: getActiveSyncId(),
    cron: getSchedulerExpression(),
  })
})

app.get('/api/syncs', async (req, res) => {
  const filterClause = SYNC_ACTIVITY_FILTERS[req.query.filter] || null
  const q = db('syncs').orderBy('started_at', 'desc').limit(20)
  if (filterClause) q.whereRaw(filterClause)
  const rows = await q
  res.json({
    syncs: rows.map((r) => ({ ...r, summary: safeJson(r.summary_json) })),
  })
})

const SYNC_ACTIVITY_FILTERS = {
  downloads: `json_extract(summary_json, '$.downloaded') > 0`,
  fails: `status IN ('error', 'partial')`,
  deletes: `json_extract(summary_json, '$.delete.triggered') = 1`,
  empty: `status = 'ok'`
    + ` AND coalesce(json_extract(summary_json, '$.downloaded'), 0) = 0`
    + ` AND coalesce(json_extract(summary_json, '$.failed'), 0) = 0`
    + ` AND coalesce(json_extract(summary_json, '$.delete.triggered'), 0) = 0`,
  manual: `json_extract(summary_json, '$.trigger') LIKE 'manual%'`,
  cron: `json_extract(summary_json, '$.trigger') = 'cron'`,
}

app.delete('/api/syncs', doubleCsrfProtection, async (req, res) => {
  const activeId = getActiveSyncId()
  const q = db('syncs')
  if (activeId) q.whereNot({ id: activeId })
  const n = await q.delete()
  res.json({ ok: true, deleted: n })
})

app.delete('/api/syncs/:id', doubleCsrfProtection, async (req, res) => {
  const id = Number(req.params.id)
  if (id === getActiveSyncId()) {
    return res.status(409).json({ error: 'cannot delete an active sync' })
  }
  const n = await db('syncs').where({ id }).delete()
  if (n === 0) return res.status(404).json({ error: 'not found' })
  res.json({ ok: true })
})

app.post(
  '/api/recordings/:fetch_id/delete-from-fetch',
  syncLimiter,
  doubleCsrfProtection,
  async (req, res) => {
    const fetchId = req.params.fetch_id
    const row = await db('recordings').where({ fetch_id: fetchId }).first()
    if (!row) return res.status(404).json({ error: 'recording not found' })
    if (row.deleted_from_fetch_at) {
      return res.status(409).json({ error: 'recording already marked deleted from Fetch' })
    }
    try {
      await deleteCloudRecordings({ recordingIds: [fetchId] })
      const now = new Date().toISOString()
      await db('recordings')
        .where({ fetch_id: fetchId })
        .update({ deleted_from_fetch_at: now })
      res.json({ ok: true, deleted_from_fetch_at: now })
    } catch (err) {
      const stage = err instanceof FetchCloudError ? err.stage : 'unknown'
      const code = err instanceof FetchCloudError ? err.code : undefined
      res.status(502).json({ ok: false, error: err.message, stage, code })
    }
  },
)

app.delete('/api/recordings', doubleCsrfProtection, async (req, res) => {
  if (req.query.deleted !== 'true') {
    return res.status(400).json({ error: 'refusing bulk delete without ?deleted=true' })
  }
  const n = await db('recordings').whereNotNull('deleted_from_fetch_at').delete()
  res.json({ ok: true, deleted: n })
})

app.delete('/api/recordings/:fetch_id', doubleCsrfProtection, async (req, res) => {
  const fetchId = req.params.fetch_id
  const row = await db('recordings').where({ fetch_id: fetchId }).first()
  if (!row) return res.status(404).json({ error: 'recording not found' })
  if (!row.deleted_from_fetch_at) {
    return res.status(409).json({ error: 'recording still on Fetch — delete from box first' })
  }
  await db('recordings').where({ fetch_id: fetchId }).delete()
  res.json({ ok: true })
})

app.get('/api/recordings', async (req, res) => {
  const SORT_COLUMNS = {
    downloaded_at: 'recordings.downloaded_at',
    size: 'recordings.size',
    status: 'recordings.status',
    fetch_title: 'recordings.fetch_title',
    show_pattern: 'shows.fetch_show_pattern',
  }
  const STATUS_VALUES = ['done', 'partial', 'failed', 'skipped', 'downloading']
  const SINCE_INTERVALS = {
    '1h':  '-1 hours',
    '24h': '-24 hours',
    '7d':  '-7 days',
    '30d': '-30 days',
    '90d': '-90 days',
  }
  const DELETED_FILTERS = {
    on_fetch: 'recordings.deleted_from_fetch_at IS NULL',
    deleted:  'recordings.deleted_from_fetch_at IS NOT NULL',
  }

  const page = Math.max(1, parseInt(req.query.page, 10) || 1)
  const pageSize = Math.min(200, Math.max(10, parseInt(req.query.pageSize, 10) || 50))
  const sortColumn = SORT_COLUMNS[req.query.sort] || SORT_COLUMNS.downloaded_at
  const sortDir = req.query.dir === 'asc' ? 'asc' : 'desc'
  const isRecordingVirtual = req.query.status === 'recording'
  const statusFilter = STATUS_VALUES.includes(req.query.status) ? req.query.status : null
  const showIdRaw = req.query.show_id ? Number(req.query.show_id) : null
  const showIdFilter = Number.isInteger(showIdRaw) ? showIdRaw : null
  const sinceInterval = SINCE_INTERVALS[req.query.since] || null
  const deletedClause = DELETED_FILTERS[req.query.deleted] || null
  const groupTombstonesLast = req.query.deleted !== 'deleted'

  const applyFilters = (q) => {
    if (isRecordingVirtual) {
      q.where('recordings.status', 'skipped').where('recordings.error', 'currently recording')
    } else if (statusFilter) {
      q.where('recordings.status', statusFilter)
    }
    if (showIdFilter != null) q.where('recordings.show_id', showIdFilter)
    if (sinceInterval) {
      q.where('recordings.downloaded_at', '>=', db.raw(`datetime('now', '${sinceInterval}')`))
    }
    if (deletedClause) q.whereRaw(deletedClause)
    return q
  }

  const totalQuery = applyFilters(
    db('recordings').leftJoin('shows', 'recordings.show_id', 'shows.id'),
  ).count({ count: 'recordings.fetch_id' }).first()

  const rowsQuery = applyFilters(
    db('recordings').leftJoin('shows', 'recordings.show_id', 'shows.id'),
  )
    .select(
      'recordings.*',
      'shows.fetch_show_pattern as show_pattern',
      'shows.dest_folder as show_dest_folder',
    )
  if (groupTombstonesLast) {
    rowsQuery.orderByRaw('(recordings.deleted_from_fetch_at IS NULL) DESC')
  }
  rowsQuery
    .orderBy(sortColumn, sortDir)
    .orderBy('recordings.season', 'desc')
    .orderBy('recordings.episode', 'desc')
    .limit(pageSize)
    .offset((page - 1) * pageSize)

  const [totalRow, rows] = await Promise.all([totalQuery, rowsQuery])
  res.json({
    recordings: rows,
    total: Number(totalRow?.count) || 0,
    page,
    pageSize,
  })
})

app.get('/api/shows', async (req, res) => {
  const rows = await db('shows').orderBy('created_at', 'desc')
  res.json({ shows: rows })
})

app.post('/api/shows', doubleCsrfProtection, async (req, res) => {
  const {
    fetch_show_pattern,
    dest_folder,
    season_template,
    enabled,
    delete_after_download,
  } = req.body || {}
  if (!fetch_show_pattern || !dest_folder) {
    return res.status(400).json({ error: 'fetch_show_pattern and dest_folder are required' })
  }
  const inserted = await db('shows').insert({
    fetch_show_pattern: String(fetch_show_pattern).trim(),
    dest_folder: String(dest_folder).trim(),
    season_template: season_template ? String(season_template).trim() : 'Season {season}',
    enabled: enabled !== false,
    delete_after_download: delete_after_download === true,
  }).returning('id')
  const row = inserted[0]
  const id = typeof row === 'object' ? row.id : row
  res.status(201).json({ id })
})

app.patch('/api/shows/:id', doubleCsrfProtection, async (req, res) => {
  const id = Number(req.params.id)
  const patch = {}
  for (const key of ['fetch_show_pattern', 'dest_folder', 'season_template']) {
    if (req.body?.[key] !== undefined) patch[key] = String(req.body[key]).trim()
  }
  if (req.body?.enabled !== undefined) patch.enabled = Boolean(req.body.enabled)
  if (req.body?.delete_after_download !== undefined) {
    patch.delete_after_download = Boolean(req.body.delete_after_download)
  }
  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: 'no fields to update' })
  }
  const n = await db('shows').where({ id }).update(patch)
  if (n === 0) return res.status(404).json({ error: 'not found' })
  res.json({ ok: true })
})

app.delete('/api/shows/:id', doubleCsrfProtection, async (req, res) => {
  const id = Number(req.params.id)
  const n = await db('shows').where({ id }).delete()
  if (n === 0) return res.status(404).json({ error: 'not found' })
  res.json({ ok: true })
})

app.get('/api/folder-suggest', async (req, res) => {
  const show = req.query.show
  if (!show) return res.status(400).json({ error: 'show query param required' })
  try {
    const mediaRoot = await getMediaRoot()
    const match = await matchShowFolder(String(show), { mediaRoot })
    const folders = await listShowFolders(mediaRoot).catch(() => [])
    res.json({ match, folders })
  } catch (err) {
    res.json({ match: null, folders: [], error: err.message })
  }
})

app.post('/api/media-root-test', doubleCsrfProtection, async (req, res) => {
  const probePath = (req.body?.path || '').trim()
  if (!probePath) return res.status(400).json({ ok: false, error: 'path is required' })
  if (!probePath.startsWith('/')) {
    return res.status(400).json({ ok: false, error: 'path must be absolute (start with /)' })
  }
  try {
    const stat = await fs.stat(probePath)
    if (!stat.isDirectory()) {
      return res.json({ ok: false, error: `${probePath} exists but is not a directory` })
    }
    await fs.access(probePath, fs.constants.W_OK)
    res.json({ ok: true, path: probePath })
  } catch (err) {
    if (err.code === 'ENOENT') {
      return res.json({ ok: false, error: `${probePath} does not exist inside the container` })
    }
    if (err.code === 'EACCES') {
      return res.json({ ok: false, error: `${probePath} is not writable by the container user` })
    }
    res.json({ ok: false, error: `${err.code || 'error'}: ${err.message}` })
  }
})

app.post('/api/fetch-shows', syncLimiter, doubleCsrfProtection, async (req, res) => {
  try {
    const ip = await getSetting('fetch_ip')
    const port = Number((await getSetting('fetch_port')) || DEFAULT_FETCH_PORT)
    if (!ip) return res.status(400).json({ error: 'fetch_ip not configured' })

    const fetchServer = await discoverFetch({ ip, port })
    if (!fetchServer) {
      return res.status(502).json({ error: `could not reach Fetch TV at ${ip}:${port}` })
    }

    const shows = await getFetchRecordings({
      location: fetchServer,
      filters: {
        folderFilter: [],
        excludeFilter: [],
        titleFilter: [],
        showsOnly: true,
        isRecordingFilter: false,
      },
    })
    res.json({ shows: shows.map((s) => ({ id: s.id, title: s.title })) })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/discover-fetch', syncLimiter, doubleCsrfProtection, async (req, res) => {
  try {
    const servers = await discoverFetchServers()
    res.json({
      servers: servers.map((s) => {
        const u = new URL(s.url)
        return {
          ip: u.hostname,
          port: Number(u.port),
          friendlyName: s.friendlyName,
          modelName: s.modelName,
          modelNumber: s.modelNumber,
          descriptionUrl: s.url,
        }
      }),
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/settings', async (req, res) => {
  const [
    fetchIp,
    fetchPort,
    syncCron,
    plexUrl,
    plexToken,
    plexTvSectionId,
    fetchCloudActivationCode,
    fetchCloudPin,
    fetchCloudTerminalId,
    deleteAfterPlexRefreshOnly,
    plexPrefsPath,
    mediaRoot,
  ] = await Promise.all([
    getSetting('fetch_ip'),
    getSetting('fetch_port'),
    getSetting('sync_cron'),
    getSetting('plex_url'),
    getSetting('plex_token'),
    getSetting('plex_tv_section_id'),
    getSetting('fetch_cloud_activation_code'),
    getSetting('fetch_cloud_pin'),
    getSetting('fetch_cloud_terminal_id'),
    getSetting('delete_after_plex_refresh_only'),
    getPlexPrefsPath(),
    getMediaRoot(),
  ])
  res.json({
    fetch_ip: fetchIp,
    fetch_port: fetchPort,
    sync_cron: syncCron,
    sync_cron_effective: getSchedulerExpression(),
    tz: process.env.TZ || 'UTC',
    plex_url: plexUrl,
    plex_token_set: Boolean(plexToken),
    plex_tv_section_id: plexTvSectionId,
    plex_prefs_path: plexPrefsPath,
    media_root: mediaRoot,
    fetch_cloud_activation_code: fetchCloudActivationCode,
    fetch_cloud_pin_set: Boolean(fetchCloudPin),
    fetch_cloud_terminal_id: fetchCloudTerminalId,
    // Default true: don't delete from Fetch unless Plex confirmed the file is in
    // its library. Safer baseline.
    delete_after_plex_refresh_only: deleteAfterPlexRefreshOnly == null
      ? true
      : deleteAfterPlexRefreshOnly !== 'false',
  })
})

app.post('/api/settings', doubleCsrfProtection, async (req, res) => {
  const body = req.body || {}
  const writeString = async (key, value, { trim = false } = {}) => {
    if (value === undefined) return
    await setSetting(key, trim ? String(value).trim() : String(value))
  }
  await writeString('fetch_ip', body.fetch_ip)
  await writeString('fetch_port', body.fetch_port)
  await writeString('plex_url', body.plex_url, { trim: true })
  // Empty token/pin preserves the stored value.
  if (body.plex_token) await setSetting('plex_token', String(body.plex_token))
  await writeString('plex_tv_section_id', body.plex_tv_section_id, { trim: true })
  await writeString('plex_prefs_path', body.plex_prefs_path, { trim: true })
  await writeString('media_root', body.media_root, { trim: true })
  await writeString('fetch_cloud_activation_code', body.fetch_cloud_activation_code, { trim: true })
  if (body.fetch_cloud_pin) await setSetting('fetch_cloud_pin', String(body.fetch_cloud_pin))
  await writeString('fetch_cloud_terminal_id', body.fetch_cloud_terminal_id, { trim: true })
  if (body.delete_after_plex_refresh_only !== undefined) {
    await setSetting(
      'delete_after_plex_refresh_only',
      body.delete_after_plex_refresh_only ? 'true' : 'false',
    )
  }
  if (body.sync_cron !== undefined) {
    await setSetting('sync_cron', String(body.sync_cron))
    await startScheduler()
  }
  res.json({ ok: true })
})

app.post('/api/fetch-cloud-test', syncLimiter, doubleCsrfProtection, async (req, res) => {
  const { activation_code, pin } = req.body || {}
  try {
    const result = await testFetchCloudConnection({
      activationCode: activation_code !== undefined ? String(activation_code).trim() : undefined,
      pin: pin !== undefined ? String(pin) : undefined,
      // Persist only the activation_code+pin actually entered; the terminal_id
      // is auto-derived. Saves a Save click for the credentials path.
      persist: true,
    })
    res.json({
      ok: true,
      terminals: result.terminals,
      terminal_id_detected: result.terminalIdDetected,
      terminal_id_persisted: result.persisted,
    })
  } catch (err) {
    const stage = err instanceof FetchCloudError ? err.stage : 'unknown'
    const code = err instanceof FetchCloudError ? err.code : undefined
    res.status(502).json({ ok: false, error: err.message, stage, code })
  }
})

app.post('/api/plex-detect-token', doubleCsrfProtection, async (req, res) => {
  const result = await detectPlexTokenFromPreferences()
  res.status(result.ok ? 200 : 502).json(result)
})

app.post('/api/nuke-state', doubleCsrfProtection, async (req, res) => {
  if (getActiveSyncId()) {
    return res.status(409).json({ error: 'cannot nuke while a sync is running' })
  }
  await db.transaction(async (trx) => {
    await trx('recordings').delete()
    await trx('syncs').delete()
    await trx('shows').delete()
    await trx('settings').delete()
  })
  try {
    await startScheduler()
  } catch (err) {
    console.warn('[nuke] scheduler restart failed:', err.message)
  }
  res.json({ ok: true })
})

app.post('/api/discover-plex', syncLimiter, doubleCsrfProtection, async (req, res) => {
  try {
    const servers = await discoverLocalPlexServers()
    res.json({ servers })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/plex-sections', doubleCsrfProtection, async (req, res) => {
  const { plex_url, plex_token } = req.body || {}
  try {
    const sections = await listPlexSections({
      url: plex_url ? String(plex_url).trim() : undefined,
      token: plex_token ? String(plex_token) : undefined,
    })
    res.json({ sections })
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

app.post('/api/plex-refresh', doubleCsrfProtection, async (req, res) => {
  const { plex_url, plex_token, plex_tv_section_id } = req.body || {}
  const result = await notifyPlexSectionRefresh({
    url: plex_url ? String(plex_url).trim() : undefined,
    token: plex_token ? String(plex_token) : undefined,
    sectionId: plex_tv_section_id ? String(plex_tv_section_id).trim() : undefined,
  })
  res.json(result)
})

app.get('/vendor/vue.esm-browser.prod.js', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'node_modules', 'vue', 'dist', 'vue.esm-browser.prod.js'))
})

app.use(express.static(path.join(__dirname, 'web')))

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'web', 'index.html'))
})

const safeJson = (s) => {
  if (!s) return null
  try { return JSON.parse(s) } catch { return null }
}

const server = app.listen(PORT, async () => {
  console.log(`fetcharr listening on http://0.0.0.0:${PORT}`)
  try {
    await startScheduler()
  } catch (err) {
    console.error('[scheduler] failed to start:', err.message)
  }
})

const shutdown = async () => {
  stopScheduler()
  server.close()
  await db.destroy()
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
