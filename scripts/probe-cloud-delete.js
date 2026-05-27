// One-shot diagnostic: do the ARE_YOU_ALIVE handshake to get cloud IDs, then
// send a real PENDING_DELETE_RECORDINGS_BY_ID with the cloud id (not the dlnaId)
// for S18 E2 MasterChef Australia and watch what comes back.
//
// IRREVERSIBLE: actually deletes the recording from the Fetch box if the
// protocol works. Targeted at the recording the user already marked test-delete'd.
//
// Run from inside the container:
//   docker exec fetcharr node scripts/probe-cloud-delete.js

import { authenticate, openCloudWs, closeCloudWs } from '../src/fetch-cloud.js'
import { getSetting } from '../src/db.js'

const TARGET_DLNA_ID = '586451764'
const SCRIPT_TIMEOUT_MS = 30_000

const main = async () => {
  const activationCode = await getSetting('fetch_cloud_activation_code')
  const pin = await getSetting('fetch_cloud_pin')
  const terminalId = await getSetting('fetch_cloud_terminal_id')

  const { authCookie } = await authenticate({ activationCode, pin })
  const ws = await openCloudWs({ authCookie })
  console.log('[probe] WS open')

  let cloudId = null
  const alivePromise = new Promise((resolve) => {
    ws.on('message', (raw) => {
      let parsed
      try { parsed = JSON.parse(raw.toString()) } catch { return }
      const inner = parsed?.message
      const type = inner?.type
      if (type === 'I_AM_ALIVE') {
        const recs = inner?.data?.recordings || []
        const hit = recs.find((r) => String(r.dlnaId) === TARGET_DLNA_ID)
        if (hit) {
          cloudId = hit.id
          console.log(`[probe] found cloud id for dlnaId ${TARGET_DLNA_ID}: ${cloudId}`)
          console.log(`        name="${hit.name}" episode="${hit.episodeTitle}"`)
        } else {
          console.log(`[probe] dlnaId ${TARGET_DLNA_ID} NOT FOUND in ${recs.length} recordings`)
        }
        resolve()
      } else if (type === 'PENDING_DELETE_RECORDINGS_BY_ID_SUCCESS') {
        console.log('[probe] ← DELETE_SUCCESS:', JSON.stringify(parsed))
      } else if (
        type === 'RECORDINGS_DELETE'
        || type === 'RECORDINGS_UPDATE'
        || type === 'RECORDING_UPDATED'
      ) {
        console.log(`[probe] ← ${type}:`, JSON.stringify(parsed).slice(0, 1500))
      }
    })
  })

  const send = (type, values = {}) => {
    const messageId = `${terminalId}_${Date.now()}_${type}`
    const reserved = ['data', 'isQueueable', 'requiresSetTopBox', 'onlyPairedSetTopBox']
    const extras = Object.fromEntries(
      Object.entries(values).filter(([k]) => !reserved.includes(k)),
    )
    const envelope = {
      to: terminalId,
      message: {
        data: { messageId, ...(values.data || {}) },
        type,
        isQueueable: values.isQueueable ?? false,
        requiresSetTopBox: values.requiresSetTopBox ?? true,
        onlyPairedSetTopBox: values.onlyPairedSetTopBox ?? false,
        ...extras,
      },
    }
    console.log(`[probe] → ${type}:`, JSON.stringify(envelope))
    ws.send(JSON.stringify(envelope))
  }

  await new Promise((r) => setTimeout(r, 1500))
  send('ARE_YOU_ALIVE', { isQueueable: true, requiresSetTopBox: false, onlyPairedSetTopBox: true })

  await Promise.race([alivePromise, new Promise((r) => setTimeout(r, 10000))])

  if (!cloudId) {
    console.error('[probe] no cloud id resolved — aborting')
    closeCloudWs(ws)
    process.exit(2)
  }

  console.log(`[probe] sending real delete for cloudId ${cloudId}`)
  send('PENDING_DELETE_RECORDINGS_BY_ID', {
    recordingIds: [cloudId],
    startEventRequired: false,
    progressEventRequired: false,
    endEventRequired: false,
    data: { recordingIds: [cloudId] },
  })

  await new Promise((r) => setTimeout(r, SCRIPT_TIMEOUT_MS - 11500))
  closeCloudWs(ws)
  process.exit(0)
}

main().catch((err) => {
  console.error('probe failed:', err.message, err.stage, err.code)
  process.exit(1)
})
