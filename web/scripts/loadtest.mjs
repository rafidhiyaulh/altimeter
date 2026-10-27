// Load test of the job queue: re-score N essays with 1, 2, 4 and 8 competing workers and measure how long
// the queue takes to drain, jobs per second, and the time from enqueue to a new score (p50 / p95).
// Each round starts just after a minute boundary so the every-minute cron sweep does not add workers.
// usage: node --env-file=../.env.local scripts/loadtest.mjs https://<public-url> [n=600] [../docs/load_test.json]
import { writeFileSync } from 'node:fs'
import { lit, runSql } from './lib/dbq.mjs'

const [base, nArg, out] = process.argv.slice(2)
if (!base?.startsWith('http')) throw new Error('pass the public URL')
const N = Number(nArg ?? 600)
const sleep = ms => new Promise(r => setTimeout(r, ms))
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))] }

async function waitForMinuteStart() {
  while (true) {
    const s = new Date().getUTCSeconds()
    if (s >= 4 && s <= 8) return
    await sleep(500)
  }
}

async function round(workers) {
  await waitForMinuteStart()
  // a load_tests row too, so the System page shows this round as the latest batch
  const [{ t0 }] = runSql(`insert into alt.load_tests (n) values (${N});
    select now()::text as t0, count(alt.enqueue_score(id, true)) from
    (select id from alt.essays where status = 'scored' and body is not null order by random() limit ${N}) e`)
  const started = Date.now()
  const results = await Promise.all(Array.from({ length: workers }, () =>
    fetch(new URL('/api/worker', base), {
      method: 'POST',
      headers: { authorization: `Bearer ${process.env.ALT_WORKER_SECRET}`, 'content-type': 'application/json' },
      body: JSON.stringify({ trigger: 'loadtest' }),
    }).then(r => r.json()).catch(e => ({ error: String(e) }))))
  const wall = (Date.now() - started) / 1000
  const names = results.map(r => r.worker).filter(Boolean)
  const lat = runSql(`select extract(epoch from (s.valid_from - ${lit(t0)}::timestamptz))::float8 as s
    from alt.essay_scores s where s.valid_from >= ${lit(t0)}::timestamptz and s.scored_by = any (array[${names.map(lit).join(',')}]::text[])`).map(r => r.s)
  const [{ depth }] = runSql(`select (alt.q_stats() ->> 'depth')::int as depth`)
  const jobs = results.reduce((a, r) => a + (r.processed ?? 0), 0)
  const failed = results.reduce((a, r) => a + (r.failed ?? 0), 0)
  const row = { workers, essays: lat.length, jobs, failed, seconds: +wall.toFixed(1), jobs_per_s: +(jobs / wall).toFixed(1),
    p50_s: +pct(lat, 0.5).toFixed(1), p95_s: +pct(lat, 0.95).toFixed(1), left_in_queue: depth }
  console.log(row)
  return row
}

const rows = []
for (const w of [1, 2, 4, 8]) rows.push(await round(w))
const result = { at: new Date().toISOString(), n: N, target: new URL(base).host, rows }
if (out) writeFileSync(out, JSON.stringify(result, null, 2) + '\n')
console.table(rows)
