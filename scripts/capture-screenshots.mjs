import { chromium } from 'playwright'

const BASE = process.env.FETCHARR_URL || 'http://localhost:8124'
const OUT = process.env.SCREENSHOT_OUT || '/work/docs/img'
const ONLY = (process.env.SHOT_FILTER || '').trim()
const VIEWPORT = { width: 1280, height: 936 }

const ALL_SHOTS = [
  { hash: '#/dashboard',  file: 'screenshot-dashboard.png',  wait: '.panel-title' },
  { hash: '#/shows',      file: 'screenshot-shows.png',      wait: '.panel-title' },
  { hash: '#/syncs',      file: 'screenshot-syncs.png',      wait: '.panel-title' },
  { hash: '#/recordings', file: 'screenshot-recordings.png', wait: '.panel-title' },
  { hash: '#/settings',   file: 'screenshot-settings.png',   wait: '.panel-title' },
]

const SHOTS = ONLY
  ? ALL_SHOTS.filter((s) => s.hash.includes(ONLY) || s.file.includes(ONLY))
  : ALL_SHOTS

const SANITISED_SETTINGS = {
  fetch_ip: '192.168.1.50',
  plex_url: 'http://192.168.1.100:32400',
  plex_prefs_path: '/plex-preferences.xml',
  media_root: '/media/tv',
  fetch_cloud_activation_code: 'EX4MPL0CL0UDC0DE',
  fetch_cloud_terminal_id: 'fetcharr-ex4mple',
}

const HIDE_SCROLLBARS = `
  ::-webkit-scrollbar { width: 0 !important; height: 0 !important; }
  html, body { scrollbar-width: none !important; -ms-overflow-style: none !important; }
`

const browser = await chromium.launch()
const ctx = await browser.newContext({
  viewport: VIEWPORT,
  deviceScaleFactor: 2,
})

await ctx.addInitScript(() => {
  try { localStorage.setItem('fetcharr.welcomeDismissed', '1') } catch {}
})

await ctx.route('**/api/settings', async (route) => {
  if (route.request().method() !== 'GET') return route.continue()
  const response = await route.fetch()
  let data
  try {
    data = await response.json()
  } catch {
    return route.fulfill({ response })
  }
  const masked = { ...data }
  for (const [key, value] of Object.entries(SANITISED_SETTINGS)) {
    if (masked[key]) masked[key] = value
  }
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(masked),
  })
})

const page = await ctx.newPage()

for (const shot of SHOTS) {
  const url = `${BASE}/${shot.hash}`
  console.log(`→ ${url}`)
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForSelector(shot.wait, { timeout: 15_000 })
  await page.addStyleTag({ content: HIDE_SCROLLBARS })
  await page.waitForTimeout(800)
  await page.screenshot({
    path: `${OUT}/${shot.file}`,
    clip: { x: 0, y: 0, width: VIEWPORT.width, height: VIEWPORT.height },
  })
  console.log(`  saved ${shot.file}`)
}

await browser.close()
console.log('done')
