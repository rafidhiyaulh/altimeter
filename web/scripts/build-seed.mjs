// Turn ml/data/work/synth.json into SQL seed chunks (db/seed/*.sql, git-ignored: they hold corpus text).
// Timestamps are written relative to now(), so the demo always looks current: day 0 = 16 weeks ago.
// usage: node scripts/build-seed.mjs ../ml/data/work ../db/seed
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { questionType, tokenize } from '../src/lib/essay/features.ts'

const [dir, out] = process.argv.slice(2)
const synth = JSON.parse(readFileSync(`${dir}/synth.json`, 'utf8'))
const corpus = new Map(readFileSync(`${dir}/essays.jsonl`, 'utf8').split('\n').filter(Boolean).map(l => { const r = JSON.parse(l); return [r.id, r] }))
const sha = s => createHash('sha256').update(s, 'utf8').digest('hex')
const SPAN = synth.weeks * 7
const YEAR = 2026

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
let fileNo = 0
function emit(name, sql) {
  if (sql.includes('$j$') === false) {} // payloads are checked below
  writeFileSync(`${out}/${String(++fileNo).padStart(2, '0')}_${name}.sql`, sql)
}
function payload(rows) {
  const j = JSON.stringify(rows)
  if (j.includes('$j$')) throw new Error('payload contains the dollar-quote tag')
  return `$j$${j}$j$::jsonb`
}
function chunks(rows, maxBytes) {
  const out = []
  let cur = []
  let size = 0
  for (const r of rows) {
    const n = JSON.stringify(r).length
    if (size + n > maxBytes && cur.length) { out.push(cur); cur = []; size = 0 }
    cur.push(r); size += n
  }
  if (cur.length) out.push(cur)
  return out
}

// 1. reference data and organisations
const insts = synth.institutions.map((i, k) => ({ id: k + 1, key: i.key, name: i.name, kind: i.kind, city: i.city, minors: i.minors }))
const instId = new Map(insts.map(i => [i.key, i.id]))
const cohorts = []
for (const i of synth.institutions) for (const c of i.cohorts) cohorts.push({ id: cohorts.length + 1, inst: instId.get(i.key), key: c.key, name: c.name,
  target: c.target, min: c.min, deadline: c.deadline, capacity: c.capacity })
const cohortId = new Map(cohorts.map(c => [c.key, c.id]))
emit('orgs', `
begin;
truncate alt.attempts, alt.essay_feedback, alt.essay_scores, alt.review_queue, alt.readiness, alt.readiness_pending,
  alt.official_results, alt.consents, alt.dsr_requests, alt.reports, alt.idempotency restart identity cascade;
delete from alt.essays; delete from alt.students; delete from alt.prompts;
insert into alt.institutions (id, key, name, kind, city, serves_minors)
select id, key, name, kind, city, minors from jsonb_to_recordset(${payload(insts)}) as x(id smallint, key text, name text, kind text, city text, minors boolean)
on conflict (id) do update set key = excluded.key, name = excluded.name, kind = excluded.kind, city = excluded.city, serves_minors = excluded.serves_minors;
insert into alt.cohorts (id, institution_id, key, name, target_overall, target_min_skill, deadline, weekly_capacity)
select id, inst, key, name, target, min, deadline, capacity
from jsonb_to_recordset(${payload(cohorts)}) as x(id smallint, inst smallint, key text, name text, target numeric, min numeric, deadline date, capacity int)
on conflict (id) do update set name = excluded.name, target_overall = excluded.target_overall, target_min_skill = excluded.target_min_skill,
  deadline = excluded.deadline, weekly_capacity = excluded.weekly_capacity;
insert into alt.retention_policies (data_kind, keep_days, keep_days_minor, basis, action) values
  ('essay_text', 365, 180, 'Contract with the institution; learner consent for AI feedback', 'Essay text deleted, band scores kept'),
  ('ai_feedback', 180, 90, 'Learner or guardian consent (ai_feedback)', 'Feedback deleted'),
  ('audio', 30, 14, 'Consent (audio_retention); speaking practice only', 'Recording deleted after scoring (not stored in this prototype)'),
  ('face_embedding', 7, 1, 'Exam integrity check, explicit consent', 'Embedding deleted after the proctored test (not stored in this prototype)'),
  ('scores', 1095, 730, 'Legitimate interest: progress, calibration', 'Pseudonymised after the retention period')
on conflict (data_kind) do update set keep_days = excluded.keep_days, keep_days_minor = excluded.keep_days_minor,
  basis = excluded.basis, action = excluded.action;
commit;
`)

// 2. prompts
const prompts = Object.entries(synth.prompts).map(([key, body], k) => ({ id: k + 1, key, body, qt: questionType(body), sha: sha(body) }))
const promptId = new Map(prompts.map(p => [p.key, p.id]))
for (const [n, part] of chunks(prompts, 700_000).entries()) emit(`prompts_${n}`, `
insert into alt.prompts (id, body, question_type, source, body_sha256)
select id, body, qt, 'btnotpt/ielts_task_2 (Apache-2.0)', sha from jsonb_to_recordset(${payload(part.map(r => { const p = { ...r }; delete p.key; return p }))})
  as x(id int, body text, qt text, sha text) on conflict (body_sha256) do nothing;
select setval(pg_get_serial_sequence('alt.prompts', 'id'), (select max(id) from alt.prompts));
`)

// 3. learners and consents
const students = synth.students.map(s => ({ id: s.sid, inst: instId.get(s.inst), cohort: cohortId.get(s.cohort), ref: s.external_ref,
  name: s.name, by: YEAR - s.age, eng: s.engagement }))
emit('students', `
insert into alt.students (id, institution_id, cohort_id, external_ref, display_name, birth_year, synthetic_engagement)
select id, inst, cohort, ref, name, by, eng from jsonb_to_recordset(${payload(students)})
  as x(id int, inst smallint, cohort smallint, ref text, name text, by smallint, eng text);
select setval(pg_get_serial_sequence('alt.students', 'id'), (select max(id) from alt.students));
`)
const consents = []
for (const s of synth.students) {
  const minor = s.guardian_consent !== null
  if (minor ? s.guardian_consent : s.sid % 10 !== 3) {
    consents.push({ sid: s.sid, kind: minor ? 'guardian' : 'self', scope: 'ai_feedback', ev: sha(`consent-form:${s.external_ref}:ai_feedback`), d: s.start_day })
    consents.push({ sid: s.sid, kind: minor ? 'guardian' : 'self', scope: 'share_with_institution', ev: sha(`consent-form:${s.external_ref}:share`), d: s.start_day })
  }
}
emit('consents', `
insert into alt.consents (student_id, kind, scope, evidence_sha256, granted_at)
select sid, kind, scope, ev, now() - ((${SPAN} - d) * interval '1 day') from jsonb_to_recordset(${payload(consents)})
  as x(sid int, kind text, scope text, ev text, d numeric);
`)

// 4. practice attempts (writing comes later, from the worker scoring the essays)
for (const [n, part] of chunks(synth.attempts, 600_000).entries()) emit(`attempts_${n}`, `
insert into alt.attempts (student_id, skill, source, band, raw_score, taken_at, via)
select sid, skill, source, band, raw, now() - ((${SPAN} - day) * interval '1 day'), 'seed'
from jsonb_to_recordset(${payload(part.map(a => ({ sid: a.sid, skill: a.skill, source: a.source, band: a.band, raw: a.raw ?? null, day: a.day })))})
  as x(sid int, skill text, source text, band numeric, raw smallint, day numeric);
`)

// 5. essays (real corpus text), queued for the real worker
const essays = synth.essays.map(e => {
  const r = corpus.get(e.essay_id)
  return { sid: e.sid, pid: promptId.get(e.prompt_key), body: r.essay, words: tokenize(r.essay).length, sha: sha(r.essay), day: e.day, ref: e.essay_id }
})
for (const [n, part] of chunks(essays, 650_000).entries()) emit(`essays_${n}`, `
insert into alt.essays (student_id, prompt_id, body, word_count, body_sha256, submitted_at, status, via, corpus_ref)
select sid, pid, body, words, sha, now() - ((${SPAN} - day) * interval '1 day'), 'queued', 'seed', ref
from jsonb_to_recordset(${payload(part)}) as x(sid int, pid int, body text, words int, sha text, day numeric, ref text);
`)

// 6. official results
emit('officials', `
insert into alt.official_results (student_id, test_date, reading, listening, writing, speaking, overall, verified)
select sid, (now() - ((${SPAN} - day) * interval '1 day'))::date, reading, listening, writing, speaking, overall, verified
from jsonb_to_recordset(${payload(synth.officials)}) as x(sid int, day numeric, reading numeric, listening numeric, writing numeric,
  speaking numeric, overall numeric, verified text)
on conflict do nothing;
`)

// 7. corpus labels kept server-side for the synthetic teacher reviews (scripts/seed-reviews.mjs)
writeFileSync(`${out}/labels.json`, JSON.stringify(Object.fromEntries(synth.essays.map(e => [e.essay_id, e.labels]))))
console.log({ institutions: insts.length, cohorts: cohorts.length, prompts: prompts.length, students: students.length,
  consents: consents.length, attempts: synth.attempts.length, essays: essays.length, officials: synth.officials.length, files: fileNo })
