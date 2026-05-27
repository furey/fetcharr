import { chromium } from 'playwright'

const BASE = process.env.FETCHARR_URL || 'http://localhost:8124'
const OUT = process.env.SCREENSHOT_OUT || '/work/docs/img'
const VIEWPORT = { width: 1280, height: 936 }

const SHOTS = [
  { hash: '#/dashboard',  file: 'screenshot-dashboard.png',  wait: '.panel-title' },
  { hash: '#/shows',      file: 'screenshot-shows.png',      wait: '.panel-title' },
  { hash: '#/syncs',      file: 'screenshot-syncs.png',      wait: '.panel-title' },
  { hash: '#/recordings', file: 'screenshot-recordings.png', wait: '.panel-title' },
]

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
