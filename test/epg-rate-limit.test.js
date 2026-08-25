import { test, mock, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fetcharr-test-')), 'state.db')

const { db, setSetting } = await import('../src/db.js')
const axios = (await import('axios')).default
const { fetchEpgChannels, rateLimitDelayMs } = await import('../src/fetch-cloud.js')
const { getGuideDay } = await import('../src/epg.js')

await db.migrate.latest()
await setSetting('fetch_cloud_activation_code', '123456')
await setSetting('fetch_cloud_pin', '1234')
await setSetting('epg_channel_lineup', JSON.stringify([
  { id: 'dvb-1', epgId: 101, number: 10, name: 'Ten', hd: false, recordable: true, logo: '', thumb: '' },
]))

after(() => db.destroy())

let onGet = async () => { throw new Error('unexpected axios.get') }
mock.method(axios, 'post', async () => ({
  status: 200,
  headers: { 'set-cookie': ['auth=test-token; Path=/'] },
  data: { terminals: [] },
}))
const getMock = mock.method(axios, 'get', async (url, opts) => onGet(url, opts))

const respond429 = (headers = {}) => async () => ({ status: 429, headers, data: {} })
const respondChannels = async () => ({ status: 200, headers: {}, data: { channels: {}, region_details: {} } })
const respondPrograms = (dayStartMs) => async () => ({
  status: 200,
  headers: {},
  data: {
    __meta__: { program_fields: ['program_id', 'title', 'start', 'end', 'synopsis_id', 'epg_program_id'] },
    channels: { 101: [[1, 'News', dayStartMs + HOUR_MS, dayStartMs + 2 * HOUR_MS, 's1', 9001]] },
    synopses: { s1: 'The bulletin.' },
  },
})

test('rateLimitDelayMs: Retry-After seconds win', () => {
  assert.equal(rateLimitDelayMs({ 'retry-after': '30' }), 30_000)
})

test('rateLimitDelayMs: reset headers as delta seconds', () => {
  assert.equal(rateLimitDelayMs({ 'x-ratelimit-reset': '5' }), 5000)
  assert.equal(rateLimitDelayMs({ 'ratelimit-reset': '2' }), 2000)
})

test('rateLimitDelayMs: reset headers as an epoch timestamp', () => {
  const delay = rateLimitDelayMs({ 'ratelimit-reset': String(Math.floor(Date.now() / 1000) + 30) })
  assert.ok(delay > 28_000 && delay <= 30_000, `expected ~30s, got ${delay}ms`)
})

test('rateLimitDelayMs: falls back to 60s without usable headers', () => {
  assert.equal(rateLimitDelayMs(undefined), 60_000)
  assert.equal(rateLimitDelayMs({}), 60_000)
  assert.equal(rateLimitDelayMs({ 'retry-after': '0' }), 60_000)
  assert.equal(rateLimitDelayMs({ 'retry-after': 'Wed, 21 Oct 2026 07:28:00 GMT' }), 60_000)
})

test('epgGet: a 429 opens a request-blocking cooldown that lifts on time', async () => {
  mock.timers.enable({ apis: ['Date'], now: Date.now() })
  try {
    onGet = respond429({ 'retry-after': '30' })
    await assert.rejects(fetchEpgChannels(), (err) => err.status === 429 && err.code === 'rate-limited')
    const callsAfter429 = getMock.mock.callCount()

    await assert.rejects(fetchEpgChannels(), (err) => err.code === 'rate-limited')
    assert.equal(getMock.mock.callCount(), callsAfter429)

    mock.timers.tick(31_000)
    onGet = respondChannels
    const { channels } = await fetchEpgChannels()
    assert.deepEqual(channels, {})
    assert.equal(getMock.mock.callCount(), callsAfter429 + 1)
  } finally {
    mock.timers.reset()
  }
})

test('guide: a 429 on refresh serves the cached guide with stale:true', async () => {
  const base = new Date(Date.now() + DAY_MS)
  base.setHours(10, 0, 0, 0)
  mock.timers.enable({ apis: ['Date'], now: base.getTime() })
  try {
    const dayStartMs = base.getTime() - 10 * HOUR_MS
    onGet = async (url) => (url.includes('programslist')
      ? respondPrograms(dayStartMs)()
      : respondChannels())
    const fresh = await getGuideDay({ day: 0 })
    assert.equal(fresh.stale, false)
    assert.equal(fresh.channels.length, 1)
    assert.equal(fresh.programs['dvb-1'].length, 1)

    mock.timers.tick(61 * 60 * 1000)
    onGet = respond429({})
    const stale = await getGuideDay({ day: 0 })
    assert.equal(stale.stale, true)
    assert.equal(stale.channels.length, 1)
    assert.equal(stale.programs['dvb-1'][0].title, 'News')
    assert.equal(stale.fetchedAt, fresh.fetchedAt)
  } finally {
    mock.timers.reset()
  }
})

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
