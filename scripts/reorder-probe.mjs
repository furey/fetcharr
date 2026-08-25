import { authenticate, openCloudWs, closeCloudWs, getBoxState } from '../src/fetch-cloud.js'
import { getSetting } from '../src/db.js'

const LISTEN_MS = 20000

const main = async () => {
  const mode = process.argv[2]
  const valuesJson = process.argv[3]
  if (!mode || (mode === 'send' && !valuesJson)) {
    console.log('usage: node reorder-probe.mjs list')
    console.log('       node reorder-probe.mjs send \'{"seriesTagIds":["...","..."]}\'')
    process.exit(1)
  }
  const before = await getBoxState()
  const tags = [...before.seriesTags].sort((a, b) => a.priority - b.priority)
  console.log('--- seriesTags (priority order) ---')
  for (const t of tags) console.log(`${String(t.priority).padStart(2)} ${t.id} ${t.name}`)
  if (mode === 'list') process.exit(0)

  const values = JSON.parse(valuesJson)
  const activationCode = await getSetting('fetch_cloud_activation_code')
  const pin = await getSetting('fetch_cloud_pin')
  const terminalId = await getSetting('fetch_cloud_terminal_id')
  const { authCookie } = await authenticate({ activationCode, pin })
  const ws = await openCloudWs({ authCookie })
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no I_AM_ALIVE within 15s')), 15000)
    const onMsg = (raw) => {
      let parsed
      try { parsed = JSON.parse(raw.toString()) } catch { return }
      if (parsed?.message?.type !== 'I_AM_ALIVE') return
      clearTimeout(timer)
      ws.removeListener('message', onMsg)
      console.log('--- handshake ok (I_AM_ALIVE received) ---')
      resolve()
    }
    ws.on('message', onMsg)
    ws.send(JSON.stringify({
      to: terminalId,
      message: {
        data: { messageId: `${terminalId}_${Date.now()}_ARE_YOU_ALIVE` },
        type: 'ARE_YOU_ALIVE',
        isQueueable: true,
        requiresSetTopBox: false,
        onlyPairedSetTopBox: true,
      },
    }))
  })
  const { data: extraData = {}, ...extraTop } = values
  const messageId = `${terminalId}_${Date.now()}_SERIES_TAG_LIST_REORDER`
  const envelope = {
    to: terminalId,
    message: {
      data: { messageId, ...extraData },
      type: 'SERIES_TAG_LIST_REORDER',
      isQueueable: false,
      requiresSetTopBox: true,
      onlyPairedSetTopBox: false,
      ...extraTop,
    },
  }
  console.log('--- sending ---')
  console.log(JSON.stringify(envelope, null, 2))
  ws.on('message', (raw) => {
    const text = raw.toString()
    let type = '?'
    try { type = JSON.parse(text)?.message?.type } catch {}
    console.log(`<<< [${type}] ${text.slice(0, 1200)}`)
  })
  ws.send(JSON.stringify(envelope))
  console.log(`--- listening ${LISTEN_MS / 1000}s ---`)
  await new Promise((r) => setTimeout(r, LISTEN_MS))
  closeCloudWs(ws)

  const after = await getBoxState()
  const afterTags = [...after.seriesTags].sort((a, b) => a.priority - b.priority)
  console.log('--- seriesTags AFTER ---')
  for (const t of afterTags) console.log(`${String(t.priority).padStart(2)} ${t.id} ${t.name}`)
  const changed = tags.some((t, i) => afterTags[i]?.id !== t.id)
  console.log(changed ? '*** ORDER CHANGED ***' : '(order unchanged)')
  process.exit(0)
}

main().catch((err) => { console.error('probe failed:', err.message, err.stage || '', err.code || ''); process.exit(1) })
