// UAT screenshots after a one-click demo login.
// usage: node scripts/shots.mjs <base> <role> <light|dark> <width> <outdir> path1 path2 ...
import { chromium } from 'playwright-core'
const [base, role, theme, width, out, ...paths] = process.argv.slice(2)
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: Number(width), height: 900 }, colorScheme: theme })
page.on('console', m => { if (m.type() === 'error') console.log('console:', m.text().slice(0, 200)) })
page.on('pageerror', e => console.log('pageerror:', e.message.slice(0, 300)))
await page.goto(base + '/login')
if (paths[0] === '/login') {
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${out}/${role}-${theme}-${width}_login.png`, fullPage: true })
  paths.shift()
}
await page.click(`button[name=demo][value=${role}]`)
await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 60000 })
for (const p of paths) {
  await page.goto(base + p, { waitUntil: 'networkidle', timeout: 90000 })
  await page.waitForTimeout(1200)
  const file = `${out}/${role}-${theme}-${width}${p.replace(/[^\w]+/g, '_')}.png`
  await page.screenshot({ path: file, fullPage: true })
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
  console.log(file, overflow ? 'HORIZONTAL OVERFLOW' : '')
}
await browser.close()
