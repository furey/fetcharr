// Diagnostic v2: do pyfetchtv's full session handshake before asking for the
// recording list, and listen long enough for async state pushes.
//
// Sequence (mirrors pyfetchtv/api/fetchtv.py login + on_message dispatch):
//   1. Authenticate (HTTP)
//   2. Open WS with auth cookie
//   3. Wait briefly for SUBSCRIPTIONS_INITIALISED frame
//   4. Send ARE_YOU_ALIVE — the box's reply (I_AM_ALIVE) carries its state
//   5. Send LIBRARY_LIST — may trigger a stream of RECORDINGS_UPDATE events
//   6. Send GET_RECORDINGS_SUMMARY
//   7. Stay connected for 60s logging everything, then close.
//
// Run from inside the container:
//   docker exec fetcharr node scripts/probe-cloud-list.js

import { authenticate, openCloudWs, closeCloudWs } from '../src/fetch-cloud.js'
import { getSetting } from '../src/db.js'

const SCRIPT_TIMEOUT_MS = 90_000
const TARGET_DLNA_IDS = ['585587764', '586451764']

const main = async () => {
  const activationCode = await getSetting('fetch_cloud_activation_code')
  const pin = await getSetting('fetch_cloud_pin')
  const terminalId = await getSetting('fetch_cloud_terminal_id')
  if (!activationCode || !pin || !terminalId) {
    console.error('Cloud creds/terminal not configured.')
    process.exit(2)
  }

  const { authCookie } = await authenticate({ activationCode, pin })
  const ws = await openCloudWs({ authCookie })
  console.log(`[probe] WS open at ${new Date().toISOString()}; terminal=${terminalId}`)

  ws.on('message', (raw) => {
    const text = raw.toString()
    try {
      const parsed = JSON.parse(text)
      const inner = parsed?.message || {}
      const type = inner.type || inner.frag || '?'
      const sender = parsed?.sender || '-'
      if (type === 'I_AM_ALIVE') {
        const recs = parsed?.message?.data?.recordings || []
        const futureCount = parsed?.message?.data?.currentFutureRecordings?.length || 0
        console.log(`[probe] ← I_AM_ALIVE: ${recs.length} recordings, ${futureCount} future`)
        for (const r of recs) {
          console.log(`  - dlnaId=${r.dlnaId} cloudId=${r.id} | ${r.name} | ${r.episodeTitle}`)
        }
        const target = recs.find((r) => TARGET_DLNA_IDS.includes(String(r.dlnaId)))
        if (target) console.log('[probe] !!! found target dlnaIds:', JSON.stringify(target))
      } else {
        console.log(`[probe] ← ${type} (from ${sender}):`, JSON.stringify(parsed).slice(0, 800))
      }
    } catch {
      console.log('[probe] ← RAW:', text.slice(0, 500))
    }
  })
  ws.on('close', (code) => console.log(`[probe] WS close code=${code}`))
  ws.on('error', (err) => console.log(`[probe] WS error: ${err.message}`))

  // Mirrors pyfetchtv's __create_msg structure exactly.
  const send = (type, {
    values,
    isQueueable = false,
    requiresSetTopBox = false,
    onlyPairedSetTopBox = false,
  } = {}) => {
    const messageId = `${terminalId}_${Date.now()}_${type}`
    const envelope = {
      to: terminalId,
      message: {
        data: { messageId },
        type,
        isQueueable,
        requiresSetTopBox,
        onlyPairedSetTopBox,
        ...(values || {}),
      },
    }
    console.log(`[probe] → ${type}:`, JSON.stringify(envelope))
    ws.send(JSON.stringify(envelope))
  }

  await new Promise((r) => setTimeout(r, 1500))

  // pyfetchtv's send_is_alive: is_queueable=true, only_paired_settopbox=true.
  // The box's I_AM_ALIVE reply populates the recording list.
  send('ARE_YOU_ALIVE', { isQueueable: true, onlyPairedSetTopBox: true })

  await new Promise((r) => setTimeout(r, 5000))

  // LIBRARY_LIST may trigger a stream of recordings rather than a single reply.
  send('LIBRARY_LIST', { requiresSetTopBox: true })

  await new Promise((r) => setTimeout(r, 5000))

  send('GET_RECORDINGS_SUMMARY', { requiresSetTopBox: true })

  await new Promise((r) => setTimeout(r, SCRIPT_TIMEOUT_MS - 12000))

  console.log('[probe] closing')
  closeCloudWs(ws)
  process.exit(0)
}

main().catch((err) => {
  console.error('probe failed:', err.message, err.stage, err.code)
  process.exit(1)
})
