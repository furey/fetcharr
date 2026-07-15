import { chromium } from 'playwright'
import { join } from 'node:path'
import { rename } from 'node:fs/promises'

const BASE = (process.env.FETCHARR_URL || 'http://localhost:8124').replace(/\/$/, '')
const OUT = process.env.WALKTHROUGH_OUT || '/work'
const VIEWPORT = { width: 1280, height: 800 }

const settings = {
  fetch_ip: '192.168.1.50',
  fetch_port: '49152',
  sync_cron: '0 3 * * *',
  sync_cron_effective: '0 3 * * *',
  tz: 'Australia/Sydney',
  plex_url: 'http://192.168.1.10:32400',
  plex_token_set: true,
  plex_tv_section_id: '2',
  plex_prefs_path: '/plex/Preferences.xml',
  media_root: '/media/tv',
  fetch_cloud_activation_code: 'A1B2-C3D4',
  fetch_cloud_pin_set: true,
  fetch_cloud_terminal_id: 'term-9f3a2b',
  delete_after_plex_refresh_only: true,
  ad_removal_enabled: true,
  ad_original_retention_days: '7',
  comskip_ini_override: false,
}

const shows = [
  { id: 1, fetch_show_pattern: 'Bluey', dest_folder: 'Bluey (2018)', season_template: 'Season {season}', enabled: true, delete_after_download: false, created_at: '2026-07-01 09:12:00', ad_removal: 'cut' },
  { id: 2, fetch_show_pattern: 'Gardening Australia', dest_folder: 'Gardening Australia', season_template: 'Season {season}', enabled: true, delete_after_download: true, created_at: '2026-06-20 18:00:00', ad_removal: 'detect' },
  { id: 3, fetch_show_pattern: 'MasterChef Australia', dest_folder: 'MasterChef Australia', season_template: 'Season {season}', enabled: true, delete_after_download: false, created_at: '2026-06-11 20:30:00', ad_removal: 'off' },
]

const recordings = [
  { fetch_id: '201', show_id: 1, fetch_title: 'Bluey - S03E12 - Family Meeting', season: 3, episode: 12, file_path: '/media/tv/Bluey (2018)/Season 3/Bluey - S03E12.ts', size: 734003200, status: 'done', error: null, downloaded_at: '2026-07-14 21:03:11', deleted_from_fetch_at: null, ad_status: 'cut', ad_breaks_json: '[{"start":63.4,"end":210.8}]', ad_processed_at: '2026-07-14 21:20:00', show_pattern: 'Bluey', show_dest_folder: 'Bluey (2018)', progress: null },
  { fetch_id: '202', show_id: 1, fetch_title: 'Bluey - S03E11 - Whale Watching', season: 3, episode: 11, file_path: '/media/tv/Bluey (2018)/Season 3/Bluey - S03E11.ts', size: 712031232, status: 'done', error: null, downloaded_at: '2026-07-14 21:01:44', deleted_from_fetch_at: null, ad_status: 'detected', ad_breaks_json: '[{"start":63.4,"end":210.8},{"start":640.2,"end":770.6}]', ad_processed_at: '2026-07-14 21:18:00', show_pattern: 'Bluey', show_dest_folder: 'Bluey (2018)', progress: null },
  { fetch_id: '203', show_id: 2, fetch_title: 'Gardening Australia - S15E20', season: 15, episode: 20, file_path: '/media/tv/Gardening Australia/Season 15/Gardening Australia - S15E20.ts', size: 2952790016, status: 'done', error: null, downloaded_at: '2026-07-13 19:40:02', deleted_from_fetch_at: '2026-07-13 20:15:00', ad_status: 'no_breaks', ad_breaks_json: null, ad_processed_at: '2026-07-13 20:05:00', show_pattern: 'Gardening Australia', show_dest_folder: 'Gardening Australia', progress: null },
  { fetch_id: '204', show_id: 3, fetch_title: 'MasterChef Australia - S16E31', season: 16, episode: 31, file_path: null, size: null, status: 'downloading', error: null, downloaded_at: null, deleted_from_fetch_at: null, ad_status: null, ad_breaks_json: null, ad_processed_at: null, show_pattern: 'MasterChef Australia', show_dest_folder: 'MasterChef Australia', progress: { phase: 'downloading', percent: 47, etaSeconds: 72, etaLabel: '1m 12s', detail: '14.8 MB/s', startedAt: 1720000000000 } },
  { fetch_id: '205', show_id: 3, fetch_title: 'MasterChef Australia - S16E30', season: 16, episode: 30, file_path: '/media/tv/MasterChef Australia/Season 16/MasterChef Australia - S16E30.ts', size: 1288490188, status: 'partial', error: 'downloaded 1.20 GB of 2.10 GB; next sync resumes', downloaded_at: '2026-07-14 20:12:00', deleted_from_fetch_at: null, ad_status: null, ad_breaks_json: null, ad_processed_at: null, show_pattern: 'MasterChef Australia', show_dest_folder: 'MasterChef Australia', progress: null },
  { fetch_id: '206', show_id: 1, fetch_title: 'Bluey - S03E10 - Onesies', season: 3, episode: 10, file_path: '/media/tv/Bluey (2018)/Season 3/Bluey - S03E10.ts', size: 698351616, status: 'done', error: null, downloaded_at: '2026-07-12 08:22:10', deleted_from_fetch_at: '2026-07-12 09:00:00', ad_status: 'cut', ad_breaks_json: '[{"start":58.0,"end":205.0}]', ad_processed_at: '2026-07-12 08:40:00', show_pattern: 'Bluey', show_dest_folder: 'Bluey (2018)', progress: null },
]

const syncs = [
  { id: 128, started_at: '2026-07-14 03:00:00', finished_at: '2026-07-14 03:04:12', status: 'ok', summary_json: '{}', summary: { trigger: 'cron', downloaded: 3, skipped: 5, failed: 0, errors: [], plex: { triggered: true, status: 200 }, delete: { triggered: true, deleted: ['201', '203', '206'], unmapped: [], deleted_at: '2026-07-14T03:04:10.000Z' }, ads: { scanned: 2, detected: 1, cut: 1, failed: 0, adSeconds: 420 } } },
  { id: 127, started_at: '2026-07-14 12:30:00', finished_at: '2026-07-14 12:31:40', status: 'ok', summary_json: '{}', summary: { trigger: 'manual-single', showId: 1, downloaded: 1, skipped: 0, failed: 0, errors: [], plex: { triggered: true, status: 200 } } },
  { id: 126, started_at: '2026-07-13 03:00:00', finished_at: '2026-07-13 03:00:31', status: 'ok', summary_json: '{}', summary: { trigger: 'cron', downloaded: 0, skipped: 8, failed: 0, errors: [] } },
  { id: 125, started_at: '2026-07-12 03:00:00', finished_at: '2026-07-12 03:06:55', status: 'partial', summary_json: '{}', summary: { trigger: 'cron', downloaded: 2, skipped: 4, failed: 1, errors: ['MasterChef Australia - S16E30: truncated'], plex: { triggered: true, status: 200 } } },
]

const routes = [
  ['**/api/settings', settings],
  ['**/api/sync-status', { activeSyncId: null, cron: '0 3 * * *' }],
  ['**/api/syncs**', { syncs }],
  ['**/api/shows', { shows }],
  ['**/api/recordings**', { recordings, total: recordings.length, page: 1, pageSize: 50 }],
  ['**/api/csrf-token', { token: 'demo' }],
  ['**/api/folder-suggest**', { match: null, folders: [] }],
]

const installCursor = (page) =>
  page.evaluate(() => {
    const c = document.createElement('div')
    c.id = '__wtc'
    c.style.cssText =
      'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;' +
      'transition:transform .6s cubic-bezier(.22,.61,.36,1);transform:translate(-80px,-80px)'
    c.innerHTML =
      '<svg width="22" height="22" viewBox="0 0 24 24">' +
      '<path d="M5 3 L5 19 L9.5 14.5 L12.5 21 L15 20 L12 13.5 L18.5 13.5 Z" ' +
      'fill="#fffcfb" stroke="#1a1611" stroke-width="1.3" stroke-linejoin="round"/></svg>'
    document.body.appendChild(c)
    window.__wt = {
      x: -80,
      y: -80,
      move(x, y) {
        this.x = x
        this.y = y
        c.style.transform = `translate(${x}px,${y}px)`
      },
      click() {
        const r = document.createElement('div')
        r.style.cssText =
          `position:fixed;left:${this.x}px;top:${this.y}px;width:10px;height:10px;` +
          'margin:-5px 0 0 -5px;border-radius:50%;border:2px solid #009be4;' +
          'z-index:2147483646;pointer-events:none;opacity:.9;' +
          'transition:transform .5s ease-out,opacity .5s ease-out'
        document.body.appendChild(r)
        requestAnimationFrame(() => {
          r.style.transform = 'scale(4)'
          r.style.opacity = '0'
        })
        setTimeout(() => r.remove(), 600)
      },
    }
  })

const cursorTo = async (page, x, y) => {
  await page.evaluate(([x, y]) => window.__wt?.move(x, y), [x, y])
  await page.waitForTimeout(680)
}

const clickTab = async (page, route) => {
  const link = page.locator(`.tab-strip a[href="#/${route}"]`)
  const box = await link.boundingBox()
  if (box) await cursorTo(page, Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2))
  await page.evaluate(() => window.__wt?.click())
  await Promise.all([
    page.waitForFunction(
      (r) => document.querySelector(`.tab-strip a[href="#/${r}"]`)?.dataset.active === 'true',
      route,
      { timeout: 8000 },
    ),
    link.click(),
  ])
  await page.waitForTimeout(500)
}

const run = async () => {
  const browser = await chromium.launch({ args: ['--font-render-hinting=none'] })
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    bypassCSP: true,
    timezoneId: 'Australia/Sydney',
    recordVideo: { dir: OUT, size: VIEWPORT },
  })

  await context.addInitScript(() => {
    try {
      localStorage.setItem('fetcharr.welcomeDismissed', '1')
    } catch {}
  })

  for (const [glob, body] of routes) {
    await context.route(glob, (route) => {
      if (route.request().method() !== 'GET') return route.fallback()
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    })
  }

  const page = await context.newPage()
  const startedAt = Date.now()
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.tab-strip a[href="#/dashboard"]', { timeout: 20000 })
  await page.waitForSelector('.panel-title', { timeout: 20000 })
  await page.addStyleTag({
    content: '::-webkit-scrollbar{width:0!important;height:0!important}html,body{scrollbar-width:none!important}',
  })
  await installCursor(page)
  await cursorTo(page, 250, 96)
  await page.waitForTimeout(400)
  const settledAt = Date.now()

  await page.waitForTimeout(2200)

  await clickTab(page, 'shows')
  await page.waitForSelector('.deck-table tbody tr, .deck-card', { timeout: 8000 }).catch(() => {})
  await page.waitForTimeout(2600)

  await clickTab(page, 'recordings')
  await page.waitForSelector('.deck-table tbody tr, .deck-card', { timeout: 8000 }).catch(() => {})
  await page.waitForTimeout(1400)
  await page.mouse.wheel(0, 240)
  await page.waitForTimeout(1800)
  await page.mouse.wheel(0, -240)
  await page.waitForTimeout(600)

  await clickTab(page, 'syncs')
  await page.waitForSelector('.deck-table tbody tr, .deck-card', { timeout: 8000 }).catch(() => {})
  await page.waitForTimeout(2600)

  await clickTab(page, 'settings')
  await page.waitForSelector('.panel-title', { timeout: 8000 }).catch(() => {})
  await page.waitForTimeout(1200)
  await page.mouse.wheel(0, 320)
  await page.waitForTimeout(1800)
  await page.mouse.wheel(0, -320)
  await page.waitForTimeout(600)

  await clickTab(page, 'dashboard')
  await page.waitForSelector('.panel-title', { timeout: 8000 }).catch(() => {})
  await cursorTo(page, 250, 96)
  await page.waitForTimeout(2200)

  const video = page.video()
  await context.close()
  if (video) {
    const dest = join(OUT, 'walkthrough.webm')
    await rename(await video.path(), dest)
    console.log(`TOUR_WEBM=${dest}`)
  }
  await browser.close()
  console.log(`TOUR_TRIM=${((settledAt - startedAt) / 1000 + 0.4).toFixed(1)}`)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
