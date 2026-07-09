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
      const recordings = parsed.message?.data?.recordings || []
      const mapByDlnaId = new Map()
      for (const r of recordings) {
        if (r?.dlnaId != null && r?.id != null) mapByDlnaId.set(String(r.dlnaId), r.id)
      }
      resolve({ recordings, mapByDlnaId })
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
