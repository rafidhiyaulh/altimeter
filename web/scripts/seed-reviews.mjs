// Synthetic teacher reviews for the demo: for ~75% of the essays in the review queue, a "teacher" marks the
// essay at its corpus label plus rater noise (sd 0.35 band per criterion). Written through alt.submit_review
// as that cohort's teacher, so the hash-chained ledger is built exactly as in production.
// usage: node --env-file=../.env.local scripts/seed-reviews.mjs ../db/seed/labels.json
import { readFileSync } from 'node:fs'
import { runSql, lit } from './lib/dbq.mjs'

const labels = JSON.parse(readFileSync(process.argv[2], 'utf8'))
let seed = 42
const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
const gauss = () => { const u = rand() || 1e-9; const v = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) }
const half = x => Math.min(9, Math.max(1, Math.floor(x * 2 + 0.5) / 2))

const rows = runSql(`
  select q.essay_id, e.corpus_ref, (select t.user_id from alt.teacher_cohorts t where t.cohort_id = s.cohort_id limit 1) as teacher
  from alt.review_queue q join alt.essays e on e.id = q.essay_id join alt.students s on s.id = e.student_id
  where q.done_at is null and e.corpus_ref is not null and e.submitted_at < now() - interval '2 days'
  order by e.submitted_at`)
const picked = rows.filter(r => r.teacher && labels[r.corpus_ref] && rand() < 0.75)
const stmts = picked.map(r => {
  const l = labels[r.corpus_ref]
  const b = k => half(l[k] + gauss() * 0.35)
  return `select set_config('request.jwt.claims', ${lit(JSON.stringify({ sub: r.teacher }))}, true);
select alt.submit_review(${lit(r.essay_id)}::uuid, ${b('TR')}, ${b('CC')}, ${b('LR')}, ${b('GRA')}, null);`
})
for (let i = 0; i < stmts.length; i += 60) runSql(`begin;\n${stmts.slice(i, i + 60).join('\n')}\ncommit;`)
console.log('reviews written', picked.length, 'of queue', rows.length)
console.log(runSql(`select alt.verify_chains() as v`)[0].v)
