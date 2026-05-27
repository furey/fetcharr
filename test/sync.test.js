import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'

import { classifyOutcome, matchShow, buildDestPath } from '../src/sync.js'

test('matchShow: case-insensitive substring match', () => {
  const shows = [
    { id: 1, fetch_show_pattern: 'MasterChef Australia' },
    { id: 2, fetch_show_pattern: 'Bluey' },
  ]
  assert.equal(matchShow(shows, 'MASTERCHEF AUSTRALIA').id, 1)
  assert.equal(matchShow(shows, 'masterchef australia: special')?.id, 1)
  assert.equal(matchShow(shows, 'Bluey (2018)').id, 2)
})

test('matchShow: no match returns undefined', () => {
  const shows = [{ id: 1, fetch_show_pattern: 'Bluey' }]
  assert.equal(matchShow(shows, 'Peppa Pig'), undefined)
})

test('matchShow: empty shows list returns undefined', () => {
  assert.equal(matchShow([], 'Anything'), undefined)
})

test('matchShow: pattern is substring, not whole-word', () => {
  // Substring matching is intentional — the user enters a discriminating
  // substring, not a regex, and Fetch's show titles can have date suffixes.
  const shows = [{ id: 1, fetch_show_pattern: 'Survivor' }]
  assert.equal(matchShow(shows, 'Australian Survivor').id, 1)
})

test('buildDestPath: substitutes {season} (padded) by default', () => {
  const p = buildDestPath({
    item: { title: 'S01 E03', season_number_padded: '01', season_number: '1', ext: 'ts' },
    show: { dest_folder: 'Bluey (2018)', season_template: 'Season {season}' },
    mediaRoot: '/media/tv',
  })
  assert.equal(p, path.join('/media/tv', 'Bluey (2018)', 'Season 01', 'S01 E03.ts'))
})

test('buildDestPath: all three placeholders resolve correctly', () => {
  const item = { title: 'EP', season_number_padded: '07', season_number: '7', ext: 'ts' }
  const show = {
    dest_folder: 'Show',
    season_template: 'p={season_padded} u={season_unpadded} default={season}',
  }
  const p = buildDestPath({ item, show, mediaRoot: '/m' })
  assert.equal(path.basename(path.dirname(p)), 'p=07 u=7 default=07')
})

test('buildDestPath: missing season info falls back to "00" / "0"', () => {
  const p = buildDestPath({
    item: { title: 'Movie', season_number_padded: null, season_number: null, ext: 'mp4' },
    show: { dest_folder: 'Movies', season_template: 'Season {season}' },
    mediaRoot: '/m',
  })
  assert.equal(p, path.join('/m', 'Movies', 'Season 00', 'Movie.mp4'))
})

test('buildDestPath: ext defaults to ts when item.ext is missing', () => {
  const p = buildDestPath({
    item: { title: 'X', season_number_padded: '02', season_number: '2', ext: null },
    show: { dest_folder: 'F', season_template: 'S{season}' },
    mediaRoot: '/m',
  })
  assert.equal(path.extname(p), '.ts')
})

test('buildDestPath: special characters in title are sanitised', () => {
  const p = buildDestPath({
    item: {
      title: 'Title: With / Slashes & "quotes"',
      season_number_padded: '01',
      season_number: '1',
      ext: 'ts',
    },
    show: { dest_folder: 'F', season_template: 'S{season}' },
    mediaRoot: '/m',
  })
  // Exact sanitisation is fetchtv.createValidFilename's call; minimum requirement
  // is that the path separator must not appear in the filename portion.
  assert.equal(path.basename(p).includes('/'), false)
})

test('classifyOutcome: successful download with matching size → done / downloaded', () => {
  const o = classifyOutcome({
    downloadResult: { recorded: true },
    expectedSize: 1_000_000_000,
    actualSize: 1_000_000_000,
  })
  assert.equal(o.dbStatus, 'done')
  assert.equal(o.summaryKey, 'downloaded')
  assert.equal(o.sizeToStore, 1_000_000_000)
  assert.equal(o.error, null)
  assert.equal(o.markDownloadedAt, true)
})

test('classifyOutcome: tiny shortfall (under tolerance) still counts as done', () => {
  // The real-world MasterChef Encore case — Δ 20-48 bytes (MPEG-TS packet alignment).
  const o = classifyOutcome({
    downloadResult: { recorded: true },
    expectedSize: 2_620_567_552,
    actualSize: 2_620_567_532,  // Δ 20 bytes
  })
  assert.equal(o.dbStatus, 'done')
  assert.equal(o.summaryKey, 'downloaded')
  assert.equal(o.sizeToStore, 2_620_567_532, 'should store actual on-disk size')
})

test('classifyOutcome: shortfall over tolerance → partial / failed', () => {
  const o = classifyOutcome({
    downloadResult: { recorded: true },
    expectedSize: 4_000_000_000,
    actualSize: 2_500_000_000,  // Δ 1.5 GB — recording was still being written
  })
  assert.equal(o.dbStatus, 'partial')
  assert.equal(o.summaryKey, 'failed')
  assert.equal(o.sizeToStore, 2_500_000_000)
  assert.match(o.error, /truncated/)
  assert.match(o.error, /1500000000/)  // shortfall in error message
})

test('classifyOutcome: shortfall exactly at tolerance is considered done', () => {
  // Tolerance is exclusive: > tolerance triggers partial.
  const o = classifyOutcome({
    downloadResult: { recorded: true },
    expectedSize: 1_000_000_000,
    actualSize: 999_000_000,  // Δ 1_000_000 == tolerance
    tolerance: 1_000_000,
  })
  assert.equal(o.dbStatus, 'done')
})

test('classifyOutcome: shortfall just over tolerance triggers partial', () => {
  const o = classifyOutcome({
    downloadResult: { recorded: true },
    expectedSize: 1_000_000_000,
    actualSize: 998_999_999,  // Δ 1_000_001 > tolerance
    tolerance: 1_000_000,
  })
  assert.equal(o.dbStatus, 'partial')
})

test('classifyOutcome: actualSize null (stat failed) trusts expectedSize → done', () => {
  // We couldn't stat the file post-download; don't penalise, store expected.
  const o = classifyOutcome({
    downloadResult: { recorded: true },
    expectedSize: 5_000_000_000,
    actualSize: null,
  })
  assert.equal(o.dbStatus, 'done')
  assert.equal(o.sizeToStore, 5_000_000_000)
})

test('classifyOutcome: expectedSize 0 or negative is ignored for cross-check', () => {
  // Shouldn't ever reach this branch (isCurrentlyRecording catches it earlier),
  // but if it did we shouldn't flag the download as truncated.
  for (const expected of [0, -1, NaN]) {
    const o = classifyOutcome({
      downloadResult: { recorded: true },
      expectedSize: expected,
      actualSize: 1_000_000,
    })
    assert.equal(o.dbStatus, 'done', `expected=${expected} should not flag truncation`)
  }
})

test('classifyOutcome: download error → failed (DB) + failed (summary)', () => {
  const o = classifyOutcome({
    downloadResult: { recorded: false, error: 'HTTP 500 from box' },
    expectedSize: 1_000_000_000,
    actualSize: null,
  })
  assert.equal(o.dbStatus, 'failed')
  assert.equal(o.summaryKey, 'failed')
  assert.equal(o.error, 'HTTP 500 from box')
  assert.equal(o.sizeToStore, null, 'must not overwrite existing row size')
  assert.equal(o.markDownloadedAt, false)
})

test('classifyOutcome: download warning (e.g. currently recording) → partial / skipped', () => {
  // fetchtv refuses to download when size <= 0 or MAX_OCTET marker.
  const o = classifyOutcome({
    downloadResult: {
      recorded: false,
      warning: "Skipping item, size -1 indicates it's currently recording",
    },
    expectedSize: -1,
    actualSize: null,
  })
  assert.equal(o.dbStatus, 'partial')
  assert.equal(o.summaryKey, 'skipped')
  assert.match(o.error, /currently recording/)
  assert.equal(o.markDownloadedAt, false)
})

test('classifyOutcome: download error wins over warning when both present', () => {
  const o = classifyOutcome({
    downloadResult: { recorded: false, error: 'real error', warning: 'minor warning' },
    expectedSize: 1_000_000_000,
    actualSize: null,
  })
  assert.equal(o.dbStatus, 'failed')
  assert.equal(o.error, 'real error')
})
