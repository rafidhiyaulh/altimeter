// Load db/seed/*.sql (from build-seed.mjs) in order, then queue every essay for the real scoring worker
// and every learner for a readiness forecast.
// usage: node --env-file=../.env.local scripts/seed.mjs ../db/seed
import { readdirSync, readFileSync } from 'node:fs'
import { runSql } from './lib/dbq.mjs'

const dir = process.argv[2]
for (const f of readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
  const t = Date.now()
  process.stdout.write(`load ${f} ... `)
  runSql(readFileSync(`${dir}/${f}`, 'utf8'))
  console.log(`${Date.now() - t} ms`)
}
const [q] = runSql(`select count(*)::int as essays, sum((alt.enqueue_score(id) is not null)::int)::int as queued from alt.essays where status = 'queued'`)
console.log('score jobs', q)
const [r] = runSql(`select count(*) filter (where alt.enqueue_readiness(id))::int as readiness_jobs from alt.students`)
console.log('readiness jobs', r)
console.log(runSql(`select alt.q_stats() as q`)[0].q)
