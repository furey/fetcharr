import axios from 'axios'
import WebSocket from 'ws'

import { getSetting, setSetting } from './db.js'

// Reverse-engineered Fetch TV cloud API — endpoints and message shape ported
// from pyfetchtv (jinxo13/pyfetchtv on GitHub). Lives in fetcharr rather than
// upstream `fetchtv` because upstream is intentionally LAN-only: Fetch firmware
// advertises UPnP DestroyObject in its SCPD but rejects the call ("Unknown
// Service Action"), so the only working delete path is the cloud WebSocket.

export class FetchCloudError extends Error {
  constructor(message, { stage, status, code } = {}) {
    super(message)
    this.name = 'FetchCloudError'
    this.stage = stage
    this.status = status
    this.code = code
  }
}

// POST activation_code+pin form-encoded; Fetch returns the session in an `auth`
// cookie and the user account (with terminals) in the JSON body.
export const authenticate = async ({ activationCode, pin } = {}) => {
  if (!activationCode || !pin) {
    throw new FetchCloudError(
      'Missing activation code or PIN.',
      { stage: 'auth', code: 'missing-creds' },
    )
  }

  const params = new URLSearchParams({ activation_code: activationCode, pin })
  let res
  try {
    res = await axios.post(URL_AUTHENTICATE, params.toString(), {
      headers: { ...STANDARD_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: AUTH_TIMEOUT_MS,
      validateStatus: () => true,
    })
  } catch (err) {
    throw new FetchCloudError(
      `Auth request failed: ${err.code || err.message}`,
      { stage: 'auth', code: err.code },
    )
  }

  if (res.status >= 400) {
    throw new FetchCloudError(`Auth HTTP ${res.status}`, { stage: 'auth', status: res.status })
  }

  const body = res.data
  const metaError = body?.__meta__?.error
  if (metaError) {
    throw new FetchCloudError(
      `Fetch rejected credentials: ${metaError}`,
      { stage: 'auth', code: 'rejected' },
    )
  }

  const setCookie = res.headers?.['set-cookie'] || []
  const authPair = setCookie
    .map((c) => c.split(';')[0].trim())
    .find((p) => p.startsWith('auth='))
  if (!authPair) {
    throw new FetchCloudError(
      'Auth succeeded but no auth cookie was returned.',
      { stage: 'auth', code: 'no-cookie' },
    )
  }

  const rawTerminals = body?.terminals ?? body?.account?.terminals ?? []
  const terminals = (Array.isArray(rawTerminals) ? rawTerminals : [])
    .map((t) => ({
      id: String(t.id || ''),
      friendlyName: t.friendly_name || '',
      deviceType: t.type || '',
      hasPvr: Boolean(t.pvr),
      status: t.status || '',
      activationStatus: t.activation_status || '',
    }))
    .filter((t) => t.id)

  return { authCookie: authPair, account: body, terminals }
}

export const openCloudWs = ({ authCookie }) => {
  if (!authCookie) {
    throw new FetchCloudError('Missing auth cookie.', { stage: 'ws', code: 'no-cookie' })
  }
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL_MESSAGES, {
      headers: { Cookie: authCookie },
      handshakeTimeout: WS_OPEN_TIMEOUT_MS,
    })
    const timer = setTimeout(() => {
      try { ws.terminate() } catch { /* ignore */ }
      reject(new FetchCloudError(
        'WebSocket open timed out.',
        { stage: 'ws', code: 'timeout' },
      ))
    }, WS_OPEN_TIMEOUT_MS)
    ws.once('open', () => {
      clearTimeout(timer)
      resolve(ws)
    })
    ws.once('error', (err) => {
      clearTimeout(timer)
      reject(new FetchCloudError(
        `WebSocket error: ${err.message}`,
        { stage: 'ws', code: err.code },
      ))
    })
  })
}

export const closeCloudWs = (ws) => {
  if (!ws) return
  try {
    if (ws.readyState === WebSocket.OPEN) ws.close(1000)
    else ws.terminate()
  } catch { /* ignore */ }
}

// Translates dlnaIds (UPnP ObjectIDs that fetcharr stores as recordings.fetch_id)
// to their cloud-side `id` via the ARE_YOU_ALIVE handshake, then sends a soft-delete
// envelope. Soft delete = box moves to pendingDelete with a restorationTimestamp,
// file persists briefly before GC; UPnP may still list during that window. The
// success signal that matters is PENDING_DELETE_RECORDINGS_BY_ID_SUCCESS with a
// non-empty recordingsIds/restorationTimestamps — empty arrays mean the id was
// unrecognised (the false-positive that motivated the dlnaId→cloudId translation).
export const deleteRecordings = async ({
  recordingIds: dlnaIds,
  activationCode,
  pin,
  terminalId,
} = {}) => {
  // recordings.fetch_id stores values like "585587764.0" (fetchtv stringifies a
  // JS number); I_AM_ALIVE returns bare "585587764". Strip the trailing .0.
  const inputDlnaIds = (dlnaIds || [])
    .map((id) => String(id).trim().replace(/\.0$/, ''))
    .filter(Boolean)
  if (inputDlnaIds.length === 0) {
    throw new FetchCloudError(
      'No valid recordingIds provided.',
      { stage: 'send', code: 'no-ids' },
    )
  }

  const creds = await getCreds({ activationCode, pin })
  const tid = terminalId ?? (await getSetting('fetch_cloud_terminal_id'))
  if (!tid) {
    throw new FetchCloudError(
      'No terminal_id configured. Run Test connection first.',
      { stage: 'send', code: 'no-terminal' },
    )
  }

  const { authCookie } = await authenticate(creds)
  const ws = await openCloudWs({ authCookie })

  try {
    const { mapByDlnaId } = await fetchLibraryWithRetry(ws, tid)
    const { cloudIds, unmappedDlnaIds } = translateToCloudIds(inputDlnaIds, mapByDlnaId)
    if (cloudIds.length === 0) {
      throw new FetchCloudError(
        `Recording(s) not in Fetch's cloud library: ${unmappedDlnaIds.join(', ')}.`
          + ' May have already been deleted, or the box has not synced to cloud yet.',
        { stage: 'translate', code: 'not-in-library' },
      )
    }

    return await sendDeleteAndAwaitAck({
      ws,
      terminalId: tid,
      cloudIds,
      inputDlnaIds,
      unmappedDlnaIds,
    })
  } finally {
    closeCloudWs(ws)
  }
}

// End-to-end check: authenticate, open WS, close cleanly. If exactly one terminal
// is returned and persist is true, auto-saves its ID to settings (unless already set).
export const testConnection = async ({ activationCode, pin, persist = true } = {}) => {
  const creds = await getCreds({ activationCode, pin })
  const { authCookie, terminals } = await authenticate(creds)
  const ws = await openCloudWs({ authCookie })
  closeCloudWs(ws)

  const terminalIdDetected = terminals.length === 1 ? terminals[0].id : null
  let persisted = false

  if (persist) {
    if (activationCode !== undefined) {
      await setSetting('fetch_cloud_activation_code', activationCode)
    }
    if (pin !== undefined) await setSetting('fetch_cloud_pin', pin)
    if (terminalIdDetected) {
      const existing = await getSetting('fetch_cloud_terminal_id')
      if (!existing) {
        await setSetting('fetch_cloud_terminal_id', terminalIdDetected)
        persisted = true
      }
    }
  }

  return { ok: true, terminals, terminalIdDetected, persisted }
}

// EPG REST endpoints share the auth cookie with the WebSocket relay. Sessions
// are cached briefly so a guide page render (channels + several program blocks)
// costs one authenticate, not one per request.
export const fetchEpgChannels = async () => {
  const body = await epgGet(URL_EPG_CHANNELS, {})
  return {
    channels: body?.channels || {},
    regionDetails: body?.region_details || {},
  }
}

// Guide data comes in 4-hour blocks indexed from the epoch (block = seconds/14400).
// startMs picks the first block; blockCount extends the window (6 blocks = 24h).
export const fetchEpgPrograms = async ({ channelIds, startMs, blockCount = 6 } = {}) => {
  const ids = (channelIds || []).map(Number).filter(Number.isFinite)
  if (ids.length === 0) {
    throw new FetchCloudError('No channelIds provided.', { stage: 'epg', code: 'no-channels' })
  }
  const block = Math.floor(startMs / 1000 / EPG_BLOCK_SECONDS)
  const body = await epgGet(URL_EPG_PROGRAMS, {
    channel_ids: ids.join(','),
    block: `4-${block}`,
    count: String(blockCount),
    extended: '1',
    off_air_catchup: '0',
    include_catchup: '0',
  })
  return parseEpgProgramsResponse(body)
}

// The programslist response is column-oriented: per-channel arrays of positional
// program tuples, named by __meta__.program_fields, with synopses in a side map.
// Two field schemas exist on the wire: the pyfetchtv-era one
// (program_id, …, epg_program_id) and the current one where the airing id is
// named `id` and the programme id is named `program_id`. Both normalise to
// program_id = airing id (RECORD_PROGRAM's programId) and epg_program_id =
// programme id (RECORD_PROGRAM's epgProgramId).
export const parseEpgProgramsResponse = (body) => {
  const fields = body?.__meta__?.program_fields || []
  const fieldSet = new Set(fields)
  const renamedSchema = !fieldSet.has('epg_program_id')
    && fieldSet.has('id') && fieldSet.has('program_id')
  const synopses = body?.synopses || {}
  const programsByChannel = {}
  for (const [epgId, rows] of Object.entries(body?.channels || {})) {
    programsByChannel[epgId] = (rows || []).map((row) => {
      const program = {}
      fields.forEach((name, i) => { program[name] = row[i] })
      if (renamedSchema) {
        program.epg_program_id = program.program_id
        program.program_id = program.id
      }
      if (program.synopsis_id != null) {
        program.synopsis = synopses[program.synopsis_id] || ''
      }
      return program
    })
  }
  return { programsByChannel }
}

// Full I_AM_ALIVE state dump: channel lineup, stored + scheduled recordings,
// series tags, active recordings, storage, and box hardware info.
export const getBoxState = async ({ activationCode, pin, terminalId } = {}) =>
  withCloudWs({ activationCode, pin, terminalId }, async ({ ws, tid }) => {
    const { data } = await fetchLibraryWithRetry(ws, tid)
    return {
      sysInfo: data?.sysInfo || {},
      standby: Boolean(data?.standby),
      storageInfo: data?.storageInfo || {},
      dvbChannels: data?.dvbChannels || [],
      recordings: data?.recordings || [],
      futureRecordings: data?.currentFutureRecordings || [],
      seriesTags: data?.seriesTagList || [],
      activeRecordingIds: data?.activeRecordings || [],
    }
  })

export const scheduleRecording = async ({
  channelId,
  programId,
  epgProgramId,
  leadTime = DEFAULT_LEAD_MINUTES,
  lagTime = DEFAULT_LAG_MINUTES,
  ...creds
} = {}) =>
  sendRecordingCommand({
    ...creds,
    type: 'RECORD_PROGRAM',
    values: { channelId, programId, epgProgramId, leadTime, lagTime, protected: false },
    successEvents: ['RECORD_PROGRAM_SUCCESS', 'RECORD_PROGRAM_START'],
    matchProgramId: programId,
  })

export const cancelRecording = async ({ programId, ...creds } = {}) =>
  sendRecordingCommand({
    ...creds,
    type: 'RECORD_PROGRAM_CANCEL',
    values: { programId },
    successEvents: ['RECORD_PROGRAM_CANCEL'],
    matchProgramId: programId,
  })

export const enableSeriesTag = async ({
  seriesLink,
  channelId,
  epgProgramId,
  programId,
  leadTime = DEFAULT_LEAD_MINUTES,
  lagTime = DEFAULT_LAG_MINUTES,
  episodesToKeep = 0,
  seasonsVal = 1,
  ...creds
} = {}) =>
  sendRecordingCommand({
    ...creds,
    type: 'ENABLE_SERIES_TAG',
    values: {
      seriesLink, channelId, epgProgramId, programId,
      leadTime, lagTime, episodesToKeep, seasonsVal,
    },
    successEvents: ['SERIES_TAG_SET'],
  })

export const disableSeriesTag = async ({ programId, seriesLinkId, ...creds } = {}) =>
  sendRecordingCommand({
    ...creds,
    type: 'DISABLE_SERIES_TAG',
    values: { programId, seriesLinkId },
    successEvents: ['SERIES_TAG_CANCELLED'],
    matchSeriesLinkId: seriesLinkId,
  })

// Schedule/cancel acks do not echo the request type — they arrive as a
// RECORDINGS_UPDATE event stream. Match on eventName (and programId when the
// update carries one); RECORD_PROGRAM_FAILURE and ERR_CONCURRENCY_LIMIT reject.
export const matchRecordingUpdate = ({ parsed, successEvents, matchProgramId, matchSeriesLinkId }) => {
  const inner = parsed?.message
  if (inner?.type === 'RECORD_PROGRAM_FAILURE') {
    return { error: 'Box reported RECORD_PROGRAM_FAILURE.', code: 'record-failure' }
  }
  if (inner?.type === 'ERR_CONCURRENCY_LIMIT') {
    return { error: 'Box refused: tuner/recording concurrency limit.', code: 'concurrency-limit' }
  }
  if (inner?.type !== 'RECORDINGS_UPDATE') return null
  const updates = inner?.data?.recordingUpdates || []
  const hit = updates.find((u) => {
    if (!successEvents.includes(u?.eventName)) return false
    if (matchProgramId != null) {
      const pid = u?.recording?.programId
      if (pid != null && String(pid) !== String(matchProgramId)) return false
    }
    if (matchSeriesLinkId != null) {
      const sid = u?.seriesTag?.id ?? u?.seriesTag?.seriesLinkId
      if (sid != null && String(sid) !== String(matchSeriesLinkId)) return false
    }
    return true
  })
  if (!hit) return null
  return { ok: true, eventName: hit.eventName, recording: hit.recording || null, seriesTag: hit.seriesTag || null }
}

const sendRecordingCommand = async ({
  type,
  values,
  successEvents,
  matchProgramId,
  matchSeriesLinkId,
  activationCode,
  pin,
  terminalId,
}) =>
  withCloudWs({ activationCode, pin, terminalId }, async ({ ws, tid }) => {
    // Wake the box's cloud session first — requiresSetTopBox commands are
    // dropped silently when it is asleep (same failure mode as delete).
    await fetchLibraryWithRetry(ws, tid)
    const envelope = buildEnvelope({ terminalId: tid, type, values })
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        ws.removeListener('message', onMessage)
        reject(new FetchCloudError(
          `Timed out waiting for ${type} confirmation.`,
          { stage: 'ack', code: 'timeout' },
        ))
      }, COMMAND_ACK_TIMEOUT_MS)
      const onMessage = (raw) => {
        let parsed
        try { parsed = JSON.parse(raw.toString()) } catch { return }
        const result = matchRecordingUpdate({ parsed, successEvents, matchProgramId, matchSeriesLinkId })
        if (!result) return
        clearTimeout(timer)
        ws.removeListener('message', onMessage)
        if (result.error) {
          reject(new FetchCloudError(result.error, { stage: 'ack', code: result.code }))
        } else {
          resolve(result)
        }
      }
      ws.on('message', onMessage)
      ws.send(JSON.stringify(envelope), (err) => {
        if (err) {
          clearTimeout(timer)
          ws.removeListener('message', onMessage)
          reject(new FetchCloudError(
            `Failed to send ${type}: ${err.message}`,
            { stage: 'send', code: err.code },
          ))
        }
      })
    })
  })

const withCloudWs = async ({ activationCode, pin, terminalId }, fn) => {
  const creds = await getCreds({ activationCode, pin })
  const tid = terminalId ?? (await getSetting('fetch_cloud_terminal_id'))
  if (!tid) {
    throw new FetchCloudError(
      'No terminal_id configured. Run Test connection first.',
      { stage: 'send', code: 'no-terminal' },
    )
  }
  const { authCookie } = await getCachedSession(creds)
  const ws = await openCloudWs({ authCookie })
  try {
    return await fn({ ws, tid })
  } finally {
    closeCloudWs(ws)
  }
}

// Fetch's cloud API rate limits with plain 429s. Honour any Retry-After /
// RateLimit-Reset hint it sends, fall back to a fixed cooldown otherwise, and
// short-circuit further requests (no network call) until the cooldown lifts.
let epgRateLimitedUntil = 0

const rateLimitDelayMs = (headers) => {
  const retryAfter = Number(headers?.['retry-after'])
  if (Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter * 1000
  for (const key of ['x-ratelimit-reset', 'ratelimit-reset', 'x-rate-limit-reset']) {
    const v = Number(headers?.[key])
    if (!Number.isFinite(v) || v <= 0) continue
    return v > 1e9 ? Math.max(v * 1000 - Date.now(), 1000) : v * 1000
  }
  return EPG_RATE_LIMIT_FALLBACK_MS
}

const epgGet = async (url, params) => {
  if (Date.now() < epgRateLimitedUntil) {
    const wait = Math.ceil((epgRateLimitedUntil - Date.now()) / 1000)
    throw new FetchCloudError(
      `Fetch cloud is rate limiting EPG requests — retry in ${wait}s.`,
      { stage: 'epg', status: 429, code: 'rate-limited' },
    )
  }
  const creds = await getCreds()
  const { authCookie } = await getCachedSession(creds)
  let res
  try {
    res = await axios.get(url, {
      params,
      headers: { ...STANDARD_HEADERS, Cookie: authCookie },
      timeout: EPG_TIMEOUT_MS,
      validateStatus: () => true,
    })
  } catch (err) {
    throw new FetchCloudError(
      `EPG request failed: ${err.code || err.message}`,
      { stage: 'epg', code: err.code },
    )
  }
  if (res.status === 401 || res.status === 403) {
    invalidateCachedSession()
    throw new FetchCloudError(`EPG auth rejected (HTTP ${res.status}).`, { stage: 'epg', status: res.status })
  }
  if (res.status === 429) {
    const delay = rateLimitDelayMs(res.headers)
    epgRateLimitedUntil = Date.now() + delay
    const hints = ['retry-after', 'x-ratelimit-reset', 'ratelimit-reset', 'x-ratelimit-limit', 'x-ratelimit-remaining']
      .map((k) => (res.headers?.[k] != null ? `${k}=${res.headers[k]}` : null))
      .filter(Boolean)
      .join(' ')
    console.warn(`[fetch-cloud] EPG 429 — cooling down ${Math.ceil(delay / 1000)}s${hints ? ` (${hints})` : ' (no rate-limit headers)'}`)
    throw new FetchCloudError(
      `Fetch cloud is rate limiting EPG requests — retry in ${Math.ceil(delay / 1000)}s.`,
      { stage: 'epg', status: 429, code: 'rate-limited' },
    )
  }
  if (res.status >= 400) {
    throw new FetchCloudError(`EPG HTTP ${res.status}`, { stage: 'epg', status: res.status })
  }
  const metaError = res.data?.__meta__?.error
  if (metaError) {
    throw new FetchCloudError(`EPG error: ${metaError}`, { stage: 'epg', code: 'meta-error' })
  }
  return res.data
}

let cachedSession = null

const getCachedSession = async (creds) => {
  const key = `${creds.activationCode}:${creds.pin}`
  if (cachedSession && cachedSession.key === key && cachedSession.expiresAt > Date.now()) {
    return cachedSession
  }
  const { authCookie, terminals } = await authenticate(creds)
  cachedSession = { key, authCookie, terminals, expiresAt: Date.now() + SESSION_TTL_MS }
  return cachedSession
}

const invalidateCachedSession = () => { cachedSession = null }

const sendDeleteAndAwaitAck = ({ ws, terminalId, cloudIds, inputDlnaIds, unmappedDlnaIds }) => {
  const envelope = buildEnvelope({
    terminalId,
    type: 'PENDING_DELETE_RECORDINGS_BY_ID',
    values: {
      recordingIds: cloudIds,
      startEventRequired: false,
      progressEventRequired: false,
      endEventRequired: false,
      data: { recordingIds: cloudIds },
    },
  })

  return new Promise((resolve, reject) => {
    const ackTimer = setTimeout(() => {
      reject(new FetchCloudError(
        'Timed out waiting for delete confirmation.',
        { stage: 'ack', code: 'timeout' },
      ))
    }, DELETE_ACK_TIMEOUT_MS)

    ws.on('message', (raw) => {
      let parsed
      try { parsed = JSON.parse(raw.toString()) } catch { return }
      const inner = parsed?.message
      if (inner?.type !== 'PENDING_DELETE_RECORDINGS_BY_ID_SUCCESS') return
      const ackedIds = inner?.data?.recordingsIds || []
      const restoreStamps = inner?.data?.restorationTimestamps || []
      // Box returns SUCCESS envelope with empty arrays when the id is unrecognised
      // — treat empty as failure even though the wire type says success.
      if (ackedIds.length === 0 && restoreStamps.length === 0) {
        clearTimeout(ackTimer)
        reject(new FetchCloudError(
          'Box returned PENDING_DELETE_RECORDINGS_BY_ID_SUCCESS with empty result arrays'
            + ' — recording not recognised.',
          { stage: 'ack', code: 'empty-success' },
        ))
        return
      }
      clearTimeout(ackTimer)
      resolve({
        ok: true,
        dlnaIds: inputDlnaIds,
        cloudIds,
        unmappedDlnaIds,
        ackedCloudIds: ackedIds,
        restorationTimestamps: restoreStamps,
      })
    })

    ws.on('error', (err) => {
      clearTimeout(ackTimer)
      reject(new FetchCloudError(
        `WebSocket error during delete: ${err.message}`,
        { stage: 'send', code: err.code },
      ))
    })

    ws.on('close', (code) => {
      clearTimeout(ackTimer)
      reject(new FetchCloudError(
        `WebSocket closed before ack (code ${code}).`,
        { stage: 'ack', code: 'closed' },
      ))
    })

    ws.send(JSON.stringify(envelope), (err) => {
      if (err) {
        clearTimeout(ackTimer)
        reject(new FetchCloudError(
          `Failed to send delete: ${err.message}`,
          { stage: 'send', code: err.code },
        ))
      }
    })
  })
}

// The I_AM_ALIVE reply comes from the box itself via the cloud relay, not from
// Fetch's servers — a box whose cloud session is asleep misses the first ping
// even while it answers UPnP on the LAN. ARE_YOU_ALIVE is queueable, so attempt
// one often wakes the session and the retry succeeds.
const fetchLibraryWithRetry = async (ws, terminalId) => {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fetchLibraryViaHandshake(ws, terminalId)
    } catch (err) {
      const timedOut = err instanceof FetchCloudError
        && err.stage === 'handshake'
        && err.code === 'timeout'
      if (!timedOut) throw err
      if (attempt >= HANDSHAKE_ATTEMPTS) {
        throw new FetchCloudError(
          `No I_AM_ALIVE reply after ${HANDSHAKE_ATTEMPTS} attempts`
            + ` (${(HANDSHAKE_ATTEMPTS * ARE_YOU_ALIVE_TIMEOUT_MS) / 1000}s).`
            + " The box's cloud session is likely asleep — retry shortly,"
            + ' or check the box is visible in the Fetch mobile app.',
          { stage: 'handshake', code: 'timeout' },
        )
      }
      console.warn(
        `[fetch-cloud] I_AM_ALIVE attempt ${attempt}/${HANDSHAKE_ATTEMPTS} timed out`
          + ` after ${ARE_YOU_ALIVE_TIMEOUT_MS}ms; resending ARE_YOU_ALIVE`,
      )
    }
  }
}

// Sends ARE_YOU_ALIVE and waits for I_AM_ALIVE, which carries the recording
// library with both dlnaId (UPnP ObjectID — fetcharr's fetch_id) and cloud-side
// `id` (what the delete API actually expects).
const fetchLibraryViaHandshake = (ws, terminalId) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.removeListener('message', onMessage)
      reject(new FetchCloudError(
        'Timed out waiting for I_AM_ALIVE handshake.',
        { stage: 'handshake', code: 'timeout' },
      ))
    }, ARE_YOU_ALIVE_TIMEOUT_MS)

    const onMessage = (raw) => {
      let parsed
      try { parsed = JSON.parse(raw.toString()) } catch { return }
      if (parsed?.message?.type !== 'I_AM_ALIVE') return
      clearTimeout(timer)
      ws.removeListener('message', onMessage)
      const data = parsed.message?.data || {}
      const recordings = data.recordings || []
      const mapByDlnaId = new Map()
      for (const r of recordings) {
        if (r?.dlnaId != null && r?.id != null) mapByDlnaId.set(String(r.dlnaId), r.id)
      }
      resolve({ recordings, mapByDlnaId, data })
    }

    ws.on('message', onMessage)
    // pyfetchtv pattern: isQueueable=true, onlyPairedSetTopBox=true. Without
    // this the box never auto-pushes its library state to a fresh session.
    const envelope = buildEnvelope({
      terminalId,
      type: 'ARE_YOU_ALIVE',
      isQueueable: true,
      requiresSetTopBox: false,
      onlyPairedSetTopBox: true,
    })
    ws.send(JSON.stringify(envelope), (err) => {
      if (err) {
        clearTimeout(timer)
        ws.removeListener('message', onMessage)
        reject(new FetchCloudError(
          `Failed to send ARE_YOU_ALIVE: ${err.message}`,
          { stage: 'handshake', code: err.code },
        ))
      }
    })
  })

const translateToCloudIds = (inputDlnaIds, mapByDlnaId) => {
  const cloudIds = []
  const unmappedDlnaIds = []
  for (const dlna of inputDlnaIds) {
    const cid = mapByDlnaId.get(dlna)
    if (cid != null) cloudIds.push(cid)
    else unmappedDlnaIds.push(dlna)
  }
  return { cloudIds, unmappedDlnaIds }
}

const buildEnvelope = ({
  terminalId,
  type,
  values = {},
  isQueueable = false,
  requiresSetTopBox = true,
  onlyPairedSetTopBox = false,
}) => {
  const { data: extraData = {}, ...extraTop } = values
  const messageId = `${terminalId}_${Date.now()}_${type}`
  return {
    to: terminalId,
    message: {
      data: { messageId, ...extraData },
      type,
      isQueueable,
      requiresSetTopBox,
      onlyPairedSetTopBox,
      ...extraTop,
    },
  }
}

const getCreds = async (overrides = {}) => {
  const activationCode = overrides.activationCode
    ?? (await getSetting('fetch_cloud_activation_code'))
    ?? ''
  const pin = overrides.pin ?? (await getSetting('fetch_cloud_pin')) ?? ''
  return { activationCode: activationCode.trim(), pin: pin.trim() }
}

const URL_AUTHENTICATE = 'https://apis.fetchtv.com.au/v3/authenticate'
const URL_MESSAGES = 'wss://messages.fetchtv.com.au/v2/message/ws/messages'
const URL_EPG_CHANNELS = 'https://apis.fetchtv.com.au/v2/epg/channels'
const URL_EPG_PROGRAMS = 'https://apis.fetchtv.com.au/v2/epg/programslist'

// Sent by the Android Fetch app. X-FTV-Capabilities required for the box to accept
// the auth POST; the other X-FTV-* headers mirror pyfetchtv for behavioural compat.
const STANDARD_HEADERS = {
  Accept: 'application/json',
  'Accept-Encoding': 'gzip, deflate, br',
  'X-FTV-Capabilities': 'no_pin,android,v3.21.1.4988,tenplay_v2',
  'X-FTV-Timeout': '3',
  'X-FTV-DeviceID': 'xxxx',
}

const WS_OPEN_TIMEOUT_MS = 8000
const AUTH_TIMEOUT_MS = 10000
const ARE_YOU_ALIVE_TIMEOUT_MS = 10000
const HANDSHAKE_ATTEMPTS = 2
const DELETE_ACK_TIMEOUT_MS = 15000
const COMMAND_ACK_TIMEOUT_MS = 15000
const EPG_TIMEOUT_MS = 15000
const EPG_RATE_LIMIT_FALLBACK_MS = 60_000
const EPG_BLOCK_SECONDS = 14400
const SESSION_TTL_MS = 5 * 60 * 1000
const DEFAULT_LEAD_MINUTES = 3
const DEFAULT_LAG_MINUTES = 5
