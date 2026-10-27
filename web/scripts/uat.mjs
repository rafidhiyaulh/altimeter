// UAT: clicks through the real user flows of each demo role in a browser, like a person would.
// usage: node --env-file=../.env.local scripts/uat.mjs <base> <outdir>
import { chromium } from 'playwright-core'
import { lit, runSql } from './lib/dbq.mjs'

const [base = 'http://localhost:3011', out = '/tmp'] = process.argv.slice(2)
const results = []
const created = [] // essays written during the run, removed at the end so the demo learner stays clean
const started = new Date().toISOString()
const check = (name, ok, info = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? `  (${info})` : ''}`) }
const browser = await chromium.launch({ channel: 'chrome', headless: true })

async function session(role, fn) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto(base + '/login')
  await page.click(`button[name=demo][value=${role}]`)
  await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 60000 })
  try { await fn(page) } catch (e) { check(`${role}: flow finished without an exception`, false, e.message.split('\n')[0]) }
  check(`${role}: no console or page errors`, errors.length === 0, errors[0]?.slice(0, 160))
  await ctx.close()
}
const visible = async loc => { try { await loc.first().waitFor({ timeout: 20000 }); return true } catch { return false } }
const status = page => page.locator('[role=status]').last()
const shot = (page, name) => page.screenshot({ path: `${out}/uat-${name}.png`, fullPage: true })

const ESSAY = `Many people believe that public transport should be free for everyone, while others think that passengers should pay for the service they use. In my opinion, making buses and trains free has clear benefits, but the cost should be shared in a fair way.

On the one hand, free public transport would encourage more people to leave their cars at home. In large cities such as Jakarta, traffic jams waste hours every day and pollute the air that children breathe. If buses were free, office workers and students would have a strong reason to switch, and the roads would become safer and quieter. Furthermore, families on low incomes spend a large share of their wages on travel, so removing fares would give them more money for food, housing and education.

On the other hand, running a transport network is expensive. Drivers, fuel and maintenance must be paid for, and if passengers do not pay, the money has to come from taxes. Some people argue that it is unfair for citizens who never use the bus to pay for those who do. In addition, a free service could become overcrowded, and the quality might fall if the government cannot invest enough in new vehicles.

In conclusion, I believe that public transport should be free or very cheap for students, the elderly and people on low incomes, while other passengers pay a small fare. This balanced approach would reduce traffic and pollution without placing too heavy a burden on the public budget.`

await session('admin', async page => {
  await page.goto(base + '/overview')
  check('admin: overview lists cohorts', await page.locator('a.row-link').count() > 0)
  await page.locator('a.row-link').first().click()
  await page.waitForURL(/\/cohorts\/\d+/)
  check('admin: cohort opens with the help queue', await visible(page.getByText('Who to help this week')))
  await page.locator('a.row-link').first().click()
  await page.waitForURL(/\/learners\/\d+/)
  check('admin: learner page shows the chance to pass', await visible(page.locator('.summary')))
  await shot(page, 'admin-learner')

  // Blind review: the AI score must stay hidden until the marks are saved.
  await page.goto(base + '/review')
  await page.getByRole('link', { name: 'Mark' }).first().click()
  await page.waitForURL(/\/essays\//)
  check('admin: AI score hidden while marking', !(await page.getByText('Writing model score').isVisible()))
  check('admin: save is disabled until all four marks are set', await page.getByRole('button', { name: 'Save marks' }).isDisabled())
  const selects = page.locator('.crit select')
  for (let i = 0; i < 4; i++) await selects.nth(i).selectOption('6.0')
  await page.getByRole('button', { name: 'Save marks' }).click()
  await page.getByText('Writing model score').waitFor({ timeout: 30000 })
  check('admin: after saving, the AI score and the history appear', await visible(page.getByText('History', { exact: true })))
  await shot(page, 'admin-after-review')

  // AI feedback on a consented essay, then the weekly report.
  // Essays still waiting for a blind teacher mark hide the AI parts, so pick one that is not.
  await page.goto(base + '/learners/197')
  await visible(page.locator('a[href^="/essays/"]'))
  const links = await page.locator('a[href^="/essays/"]').evaluateAll(as => as.map(a => a.getAttribute('href')))
  const draft = page.getByRole('button', { name: /^(Draft feedback|Redraft)/ })
  for (const href of links.slice(0, 5)) {
    await page.goto(base + href)
    if (await visible(page.getByText('Writing model score'))) break
  }
  if (await visible(draft)) {
    await draft.click()
    await page.locator('.fb-item').first().waitFor({ timeout: 90000 })
    check('admin: AI feedback drafted with quoted items', await page.locator('.fb-item').count() > 0, `${await page.locator('.fb-item').count()} items`)
  } else check('admin: feedback panel present', false)

  await page.goto(base + '/reports')
  await page.getByRole('button', { name: /Draft this week's report/ }).click()
  await status(page).waitFor({ timeout: 90000 })
  check('admin: weekly report drafted', /drafted|Done|report/i.test(await status(page).innerText()), await status(page).innerText())

  // Data request: open from the learner page, complete from Privacy as a download.
  await page.goto(base + '/learners/197')
  await page.getByRole('button', { name: 'Request data export' }).click()
  await status(page).waitFor()
  check('admin: data export requested', /request|open|Done/i.test(await status(page).innerText()), await status(page).innerText())
  await page.goto(base + '/privacy')
  const dl = page.waitForEvent('download', { timeout: 30000 })
  await page.getByRole('button', { name: 'Download data' }).first().click()
  const file = await dl
  check('admin: export downloads as JSON', file.suggestedFilename().endsWith('.json'), file.suggestedFilename())
  await shot(page, 'admin-privacy')

  // Indonesian works on the same pages.
  await page.getByRole('button', { name: 'ID', exact: true }).click()
  await page.getByRole('heading', { name: 'Privasi & data' }).waitFor({ timeout: 15000 })
  check('admin: switches to Indonesian', true)
  await page.goto(base + '/overview')
  check('admin: overview in Indonesian', await visible(page.getByText('Esai untuk dicek')))
  await page.getByRole('button', { name: 'EN', exact: true }).click()
})

await session('learner', async page => {
  await page.goto(base + '/me')
  check('learner: sees only their own readiness', await visible(page.getByRole('heading', { name: 'My readiness' })))
  await page.goto(base + '/write')
  await page.locator('textarea.writer').fill(ESSAY)
  await page.getByRole('button', { name: 'Submit for scoring' }).click()
  await page.waitForURL(/\/essays\//, { timeout: 30000 })
  created.push(page.url().split('/essays/')[1])
  await page.getByText('Writing model score').waitFor({ timeout: 120000 })
  check('learner: essay scored by the queue worker', true, await page.locator('.big-p').innerText())
  await shot(page, 'learner-essay')
  check('learner: cannot open staff pages', (await page.goto(base + '/overview')).url().includes('/me') || page.url().includes('/me'))
})

await session('platform', async page => {
  await page.goto(base + '/system')
  await page.locator('input[aria-label=label]').fill('UAT key')
  await page.getByRole('button', { name: 'Create key' }).click()
  await page.locator('.key-once').waitFor({ timeout: 30000 })
  check('platform: API key shown once', (await page.locator('.key-once').innerText()).startsWith('alt_live_'))
  const row = page.locator('tr', { hasText: 'UAT key' })
  await row.getByRole('button', { name: 'Revoke' }).click()
  await row.getByRole('button', { name: 'Revoke this key?' }).click()
  check('platform: API key revoked', await visible(page.getByText(/revoked keys? can no longer be used/)))

  await page.locator('input[aria-label=n]').fill('20')
  await page.getByRole('button', { name: 'Re-score batch (load test)' }).click()
  await page.getByText(/20 \/ 20 essays re-scored/).waitFor({ timeout: 180000 })
  check('platform: batch of 20 re-scored by the workers', true)
  check('platform: no double current scores', (await page.locator('.kv .v.ok').first().innerText()) === '0')
  await shot(page, 'platform-system')

  await page.goto(base + '/trust')
  const recalc = page.getByRole('button', { name: /Recalculate correction/ })
  if (await visible(recalc)) {
    await recalc.click()
    await status(page).waitFor({ timeout: 60000 })
    check('platform: correction recalculated', !(await status(page).getAttribute('class')).includes('bad'), await status(page).innerText())
  }
  await page.goto(base + '/privacy')
  await page.getByRole('button', { name: 'Delete now' }).click()
  await status(page).waitFor({ timeout: 60000 })
  check('platform: retention purge runs', !(await status(page).getAttribute('class')).includes('bad'), await status(page).innerText())
})

await browser.close()
if (created.length) {
  const ids = created.map(lit).join(', ')
  runSql(`begin; delete from alt.attempts where essay_id in (${ids}); delete from alt.essays where id in (${ids});
    select alt.enqueue_readiness(id) from alt.students where user_id is not null; commit;`)
}
// the API key the run created
runSql(`delete from alt.api_keys where created_at >= ${lit(started)}`)
const passed = results.filter(Boolean).length
console.log(`\n${passed}/${results.length} passed`)
process.exit(passed === results.length ? 0 : 1)
