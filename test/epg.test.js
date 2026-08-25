import { test } from 'node:test'
import assert from 'node:assert/strict'

import { parseEpgProgramsResponse, matchRecordingUpdate } from '../src/fetch-cloud.js'
import { mergeChannels, localMidnightMs } from '../src/epg.js'

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
      900: { epg_id: 102, name: 'ABC', image: '/logos/abc.png', high_definition: true },
    },
  })
  assert.equal(channels.length, 2)
  assert.deepEqual(channels.map((c) => c.id), [11, 12])
  assert.equal(channels[1].name, 'ABC')
  assert.equal(channels[1].hd, true)
  assert.equal(channels[1].recordable, false)
  assert.equal(channels[1].image, '/logos/abc.png')
})

test('localMidnightMs: floors to local midnight', () => {
  const ms = localMidnightMs(new Date('2026-08-25T13:45:12'))
  const d = new Date(ms)
  assert.equal(d.getHours(), 0)
  assert.equal(d.getMinutes(), 0)
  assert.equal(d.getSeconds(), 0)
  assert.equal(d.getDate(), 25)
})
