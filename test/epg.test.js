import { test } from 'node:test'
import assert from 'node:assert/strict'

import { parseEpgProgramsResponse, matchRecordingUpdate } from '../src/fetch-cloud.js'
import { mergeChannels, localMidnightMs, orderChannels, nowAndNext } from '../src/epg.js'

const FIELDS = [
  'program_id', 'title', 'start', 'end', 'synopsis_id', 'rating', 'warnings',
  'flags', 'genre', 'series_link', 'episode_title', 'series_no', 'episode_no',
  'series_id', 'epg_program_id',
]

test('parseEpgProgramsResponse: maps positional tuples by program_fields and resolves synopses', () => {
  const body = {
    __meta__: { program_fields: FIELDS },
    channels: {
      101: [
        [1, 'News', 1000, 2000, 's1', 'PG', '', '', 'News', 'sl1', 'Evening', 2, 5, 77, 9001],
      ],
    },
    synopses: { s1: 'The evening bulletin.' },
  }
  const { programsByChannel } = parseEpgProgramsResponse(body)
  const p = programsByChannel['101'][0]
  assert.equal(p.program_id, 1)
  assert.equal(p.title, 'News')
  assert.equal(p.start, 1000)
  assert.equal(p.end, 2000)
  assert.equal(p.series_link, 'sl1')
  assert.equal(p.epg_program_id, 9001)
  assert.equal(p.synopsis, 'The evening bulletin.')
})

test('parseEpgProgramsResponse: survives a reordered program_fields list', () => {
  const body = {
    __meta__: { program_fields: ['title', 'program_id'] },
    channels: { 5: [['Show', 42]] },
    synopses: {},
  }
  const { programsByChannel } = parseEpgProgramsResponse(body)
  assert.equal(programsByChannel['5'][0].program_id, 42)
  assert.equal(programsByChannel['5'][0].title, 'Show')
})

test('parseEpgProgramsResponse: normalises the renamed schema (id/program_id) to canonical ids', () => {
  const body = {
    __meta__: {
      program_fields: ['id', 'title', 'start', 'end', 'synopsis_id', 'program_id', 'hashed_program_id'],
    },
    channels: { 2: [[2513404631, 'Inside India', 1000, 2000, 's9', 435652, 'abc123']] },
    synopses: { s9: 'Synopsis.' },
  }
  const { programsByChannel } = parseEpgProgramsResponse(body)
  const p = programsByChannel['2'][0]
  assert.equal(p.program_id, 2513404631)
  assert.equal(p.epg_program_id, 435652)
  assert.equal(p.synopsis, 'Synopsis.')
})

test('parseEpgProgramsResponse: tolerates missing pieces', () => {
  assert.deepEqual(parseEpgProgramsResponse({}), { programsByChannel: {} })
  assert.deepEqual(parseEpgProgramsResponse(null), { programsByChannel: {} })
})

const wrap = (message) => ({ parsed: { sender: 't1', message } })

test('matchRecordingUpdate: resolves on a matching RECORD_PROGRAM_SUCCESS update', () => {
  const result = matchRecordingUpdate({
    ...wrap({
      type: 'RECORDINGS_UPDATE',
      data: {
        recordingUpdates: [
          { eventName: 'RECORD_PROGRAM_SUCCESS', recording: { programId: 42 } },
        ],
      },
    }),
    successEvents: ['RECORD_PROGRAM_SUCCESS', 'RECORD_PROGRAM_START'],
    matchProgramId: '42',
  })
  assert.equal(result.ok, true)
  assert.equal(result.eventName, 'RECORD_PROGRAM_SUCCESS')
  assert.equal(result.recording.programId, 42)
})

test('matchRecordingUpdate: ignores updates for a different program', () => {
  const result = matchRecordingUpdate({
    ...wrap({
      type: 'RECORDINGS_UPDATE',
      data: {
        recordingUpdates: [
          { eventName: 'RECORD_PROGRAM_SUCCESS', recording: { programId: 7 } },
        ],
      },
    }),
    successEvents: ['RECORD_PROGRAM_SUCCESS'],
    matchProgramId: 42,
  })
  assert.equal(result, null)
})

test('matchRecordingUpdate: ignores non-success event names', () => {
  const result = matchRecordingUpdate({
    ...wrap({
      type: 'RECORDINGS_UPDATE',
      data: { recordingUpdates: [{ eventName: 'RECORD_PROGRAM_STOP', recording: { programId: 42 } }] },
    }),
    successEvents: ['RECORD_PROGRAM_SUCCESS'],
    matchProgramId: 42,
  })
  assert.equal(result, null)
})

test('matchRecordingUpdate: rejects on RECORD_PROGRAM_FAILURE and concurrency limit', () => {
  const failure = matchRecordingUpdate({
    ...wrap({ type: 'RECORD_PROGRAM_FAILURE' }),
    successEvents: ['RECORD_PROGRAM_SUCCESS'],
  })
  assert.equal(failure.code, 'record-failure')
  const limit = matchRecordingUpdate({
    ...wrap({ type: 'ERR_CONCURRENCY_LIMIT' }),
    successEvents: ['RECORD_PROGRAM_SUCCESS'],
  })
  assert.equal(limit.code, 'concurrency-limit')
})

test('matchRecordingUpdate: matches series tag cancellation by seriesLinkId', () => {
  const result = matchRecordingUpdate({
    ...wrap({
      type: 'RECORDINGS_UPDATE',
      data: { recordingUpdates: [{ eventName: 'SERIES_TAG_CANCELLED', seriesTag: { id: 'sl9' } }] },
    }),
    successEvents: ['SERIES_TAG_CANCELLED'],
    matchSeriesLinkId: 'sl9',
  })
  assert.equal(result.ok, true)
  assert.equal(result.seriesTag.id, 'sl9')
})

test('mergeChannels: merges box lineup with cloud directory on epg_id, keeps box order', () => {
  const channels = mergeChannels({
    dvbChannels: [
      { id: 11, epg_id: 101, name: 'Seven', high_definition: false, isRecordable: true },
      { id: 12, epg_id: 102, name: '', isRecordable: false },
      { id: 13, epg_id: null, name: 'Ghost' },
      { id: 14, epg_id: 104, name: 'Radio', isAudio: true },
    ],
    cloudChannels: {
      900: {
        epg_id: 102,
        name: 'ABC',
        number: 2,
        high_definition: true,
        images: {
          channel_logo_offstate: {
            original: 'http://static.lb.i.fetchtv.com.au/abc-off.png',
            presets: {
              channelimage_sui_64x36_offstate_channel: 'http://static/abc-64x36.webp',
              channelimage_sui_110x62_offstate_channel: 'http://static/abc-110x62.webp',
            },
          },
          landscape_thumbnail: { original: 'http://static.fetchtv.com.au/abc-wide.png', presets: {} },
        },
      },
    },
  })
  assert.equal(channels.length, 2)
  assert.deepEqual(channels.map((c) => c.id), [11, 12])
  assert.equal(channels[1].name, 'ABC')
  assert.equal(channels[1].number, 2)
  assert.equal(channels[1].hd, true)
  assert.equal(channels[1].recordable, false)
  assert.equal(channels[1].logo, 'http://static/abc-110x62.webp')
  assert.equal(channels[1].thumb, 'http://static.fetchtv.com.au/abc-wide.png')
  assert.equal(channels[0].logo, '')
})

const LINEUP = [
  { id: 11, name: '7mate', number: 74 },
  { id: 12, name: 'ABC TV', number: 2 },
  { id: 13, name: '10 Peach', number: 12 },
  { id: 14, name: 'SBS', number: 3 },
]

test('orderChannels: pinned float to the top in pin order, rest keep default order', () => {
  const out = orderChannels({ channels: LINEUP, pinnedIds: ['14', '12'], hiddenIds: [] })
  assert.deepEqual(out.map((c) => c.id), [14, 12, 11, 13])
  assert.deepEqual(out.map((c) => c.pinned), [true, true, false, false])
})

test('orderChannels: sorts the unpinned tail by name (numeric-aware) or number', () => {
  const byName = orderChannels({ channels: LINEUP, pinnedIds: ['14'], sort: 'name' })
  assert.deepEqual(byName.map((c) => c.name), ['SBS', '7mate', '10 Peach', 'ABC TV'])
  const byNumber = orderChannels({ channels: LINEUP, pinnedIds: [], sort: 'number' })
  assert.deepEqual(byNumber.map((c) => c.number), [2, 3, 12, 74])
})

test('orderChannels: a pinned channel is never hidden; unknown pins are ignored', () => {
  const out = orderChannels({ channels: LINEUP, pinnedIds: ['12', '999'], hiddenIds: ['12', '13'] })
  assert.deepEqual(out.map((c) => c.id), [12, 11, 13, 14])
  assert.equal(out[0].hidden, false)
  assert.equal(out.find((c) => c.id === 13).hidden, true)
})

test('nowAndNext: picks the airing programme and the nearest future one', () => {
  const programs = [
    { program_id: 1, title: 'Old', start: 0, end: 100 },
    { program_id: 2, title: 'Now', start: 100, end: 200 },
    { program_id: 3, title: 'Later', start: 300, end: 400 },
    { program_id: 4, title: 'Next', start: 200, end: 300 },
  ]
  const { now, next } = nowAndNext(programs, 150)
  assert.equal(now.title, 'Now')
  assert.equal(next.title, 'Next')
  const empty = nowAndNext([], 150)
  assert.equal(empty.now, null)
  assert.equal(empty.next, null)
})

test('localMidnightMs: floors to local midnight', () => {
  const ms = localMidnightMs(new Date('2026-08-25T13:45:12'))
  const d = new Date(ms)
  assert.equal(d.getHours(), 0)
  assert.equal(d.getMinutes(), 0)
  assert.equal(d.getSeconds(), 0)
  assert.equal(d.getDate(), 25)
})
