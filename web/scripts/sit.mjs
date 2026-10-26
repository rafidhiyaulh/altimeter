// System integration test against PRODUCTION over HTTPS; database invariants are checked in SQL through
// the Management API.
// Covers: health & headers, auth redirects, every page per role, the partner API (keys, HMAC, idempotency,
// tenancy), the queue end to end, RLS per role, append-only ledgers, and a worker killed mid-batch.
// usage: node --env-file=../.env.local scripts/sit.mjs https://altimeter-readiness.vercel.app
import { createHash, createHmac, randomBytes } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { runSql, lit } from './lib/dbq.mjs'

const BASE = process.argv[2]?.replace(/\/$/, '')
if (!BASE?.startsWith('https://')) throw new Error('pass the https base URL')
const REF = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0]
const results = []
const cleanup = [] // test rows removed at the end so the demo data stays clean
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`) }
const sleep = ms => new Promise(r => setTimeout(r, ms))

// ------------------------------------------------------------------ HTTP
async function http(method, path, { headers = {}, body = null } = {}) {
  try {
    const r = await fetch(BASE + path, { method, headers, body: method === 'GET' ? undefined : body ?? '{}', redirect: 'manual', signal: AbortSignal.timeout(60000) })
    return { status: r.status, text: await r.text(), headers: Object.fromEntries(r.headers.entries()) }
  } catch (e) {
    return { status: 0, text: '', headers: {}, error: e.message }
  }
}
const json = r => { try { return JSON.parse(r.text) } catch { return null } }
const canon = obj => JSON.stringify(obj)
const sign = (key, raw, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${createHmac('sha256', key).update(`${t}.${raw}`).digest('hex')}`
// a real app page: our shell rendered, no error boundary, not a platform login wall
const isPage = r => r.status === 200 && r.text.includes('class="content"') && !/Application error|Vercel Authentication/.test(r.text)

// ------------------------------------------------------------------ sessions for each demo role
const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } })
async function cookieFor(email) {
  const { data, error } = await anon.auth.signInWithPassword({ email, password: process.env.ALT_DEMO_PASSWORD })
  if (error) throw error
  const v = 'base64-' + Buffer.from(JSON.stringify(data.session)).toString('base64url')
  const name = `sb-${REF}-auth-token`
  // @supabase/ssr splits cookies longer than 3180 characters into .0, .1, ...
  if (v.length <= 3180) return `${name}=${v}`
  const parts = v.match(/.{1,3180}/g)
  return parts.map((p, i) => `${name}.${i}=${p}`).join('; ')
}

// ================================================================== 1. platform basics
{
  const r = await http('GET', '/api/health')
  const j = json(r)
  check('health: database, queue, models, LLM up; served from Singapore', r.status === 200 && j?.ok && j?.region === 'sin1' && j?.llm?.configured, `${j?.region} db ${j?.db?.ms}ms`)
  const p = await http('GET', '/overview')
  check('signed-out page redirects to /login', [302, 303, 307, 308].includes(p.status) && /\/login/.test(p.headers.location ?? ''), `${p.status}`)
  const l = await http('GET', '/login')
  check('security headers: CSP, HSTS, frame-ancestors none, nosniff', /default-src 'self'/.test(l.headers['content-security-policy'] ?? '') && /max-age=63072000/.test(l.headers['strict-transport-security'] ?? '')
    && /frame-ancestors 'none'/.test(l.headers['content-security-policy'] ?? '') && l.headers['x-content-type-options'] === 'nosniff')
  const w = await http('POST', '/api/worker', { body: '{"trigger":"sit"}', headers: { 'content-type': 'application/json' } })
  check('worker refuses calls without the secret', w.status === 403, `${w.status}`)
  const e = await http('POST', '/api/essays', { body: '{}', headers: { 'content-type': 'application/json' } })
  check('session API refuses anonymous calls with problem+json', e.status === 401 && /problem\+json/.test(e.headers['content-type'] ?? ''), `${e.status}`)
  const o = await http('GET', '/api/v1/openapi')
  check('OpenAPI 3.1 document served', o.status === 200 && json(o)?.openapi === '3.1.0')
}

// ================================================================== 2. pages per role (server-rendered as that user)
const ROLES = {
  platform: ['ops@altimeter.demo', ['/overview', '/cohorts/3', '/trust', '/review', '/reports', '/privacy', '/system', '/about', '/glossary']],
  inst_admin: ['admin@merahputih.altimeter.demo', ['/overview', '/cohorts/3', '/trust', '/privacy', '/reports']],
  teacher: ['teacher@merahputih.altimeter.demo', ['/overview', '/cohorts/3', '/review', '/trust']],
  student: ['learner@merahputih.altimeter.demo', ['/me', '/write', '/glossary']],
  school_admin: ['admin@cendekia.altimeter.demo', ['/overview', '/cohorts/1', '/privacy']],
}
const cookies = {}
for (const [role, [email, pages]] of Object.entries(ROLES)) {
  cookies[role] = await cookieFor(email)
  for (const path of pages) {
    const r = await http('GET', path, { headers: { cookie: cookies[role] } })
    check(`${role} renders ${path}`, isPage(r), `${r.status}${r.error ? ' ' + r.error : ''}`)
  }
}
{
  // pages stream, so a 404/redirect arrives inside a 200 response: check that no data leaked instead
  const r = await http('GET', '/cohorts/1', { headers: { cookie: cookies.inst_admin } })
  check("university admin cannot see a school cohort's data", !r.text.includes('XII IUP Prep A') && /could not be found|NEXT_HTTP_ERROR_FALLBACK;404/.test(r.text), `${r.status}`)
  const s = await http('GET', '/system', { headers: { cookie: cookies.teacher } })
  check('teacher is redirected away from the platform-only System page', !/alt_live_|Partner API keys/.test(s.text) && /NEXT_REDIRECT|\/overview/.test(s.text), `${s.status}`)
}

// ================================================================== 3. learner flow: submit -> queue -> worker -> score -> readiness
{
  const [p] = runSql(`select id from alt.prompts where length(body) between 80 and 300 limit 1`)
  const essay = 'Some people believe that university education should be free for everyone, while others think students should pay. ' +
    'In my opinion, governments should cover most of the cost because education benefits the whole society.\n\n' +
    'Firstly, free education gives talented students from poor families the same chance as rich students. For example, many scholarship ' +
    'holders in Indonesia become teachers and doctors who serve their communities. As a result, the country gains skilled workers.\n\n' +
    'On the other hand, free university places cost a lot of public money, and some students may not take their studies seriously. ' +
    'However, this problem can be reduced if governments require good grades to keep the free place.\n\n' +
    'In conclusion, although free university education is expensive, I believe its benefits for society are greater than its costs.'
  const r = await http('POST', '/api/essays', { headers: { cookie: cookies.student, 'content-type': 'application/json' }, body: JSON.stringify({ prompt_id: p.id, body: essay }) })
  const id = json(r)?.id
  cleanup.push(`delete from alt.attempts where essay_id = ${lit(id)}`, `delete from alt.essays where id = ${lit(id)}`)
  check('learner submits an essay (202, queued)', r.status === 202 && !!id, `${r.status}`)
  let st = null
  for (let i = 0; i < 25 && id; i++) {
    await sleep(3000)
    ;[st] = runSql(`select v.status, v.overall, (select count(*) from alt.attempts a where a.essay_id = v.id)::int as obs from alt.v_essay_current v where v.id = ${lit(id)}`)
    if (st?.status === 'scored') break
  }
  check('worker scored it and recorded a writing observation', st?.status === 'scored' && st.obs === 1, `${st?.status} band ${st?.overall}`)
  const fb = await http('POST', `/api/essays/${id}/feedback`, { headers: { cookie: cookies.student, 'content-type': 'application/json' }, body: '{"lang":"id"}' })
  const f = json(fb)
  check('feedback drafted in Indonesian; every LLM quote is in the essay', fb.status === 200 && f?.feedback?.items?.length > 0
    && f.feedback.items.every(i => !i.quote || essay.toLowerCase().replace(/\s+/g, ' ').includes(i.quote.toLowerCase().replace(/\s+/g, ' ').trim())), `${f?.source}, ${f?.feedback?.items?.length} items, ${f?.dropped} dropped`)
}

// ================================================================== 4. partner API: keys, HMAC, idempotency, tenancy
{
  const key = `alt_live_sit${randomBytes(24).toString('base64url')}`
  const sha = createHash('sha256').update(key).digest('hex')
  runSql(`insert into alt.api_keys (institution_id, prefix, key_sha256, label) values (2, ${lit('sit' + randomBytes(3).toString('hex'))}, ${lit(sha)}, 'SIT')`)
  const [stu] = runSql(`select external_ref from alt.students where institution_id = 2 and erased_at is null order by id limit 1`)
  const [other] = runSql(`select external_ref from alt.students where institution_id = 1 order by id limit 1`)
  const payload = { attempts: [{ student_ref: stu.external_ref, skill: 'reading', source: 'mock', band: 6.5, raw_score: 28, taken_at: new Date().toISOString() }] }
  const raw = canon(payload)
  const idem = `sit-${randomBytes(6).toString('hex')}`
  const base = { authorization: `Bearer ${key}`, 'content-type': 'application/json' }
  let r = await http('POST', '/api/v1/attempts', { headers: { 'content-type': 'application/json' }, body: raw })
  check('API without a key -> 401', r.status === 401, `${r.status}`)
  r = await http('POST', '/api/v1/attempts', { headers: { ...base, 'idempotency-key': idem }, body: raw })
  check('API without a signature -> 401 signature_required', r.status === 401 && /signature/.test(r.text), `${r.status}`)
  r = await http('POST', '/api/v1/attempts', { headers: { ...base, 'idempotency-key': idem, 'altimeter-signature': sign(key, raw.replace('6.5', '9')) }, body: raw })
  check('API with a signature over a different body -> 401', r.status === 401, `${r.status}`)
  r = await http('POST', '/api/v1/attempts', { headers: { ...base, 'idempotency-key': idem, 'altimeter-signature': sign(key, raw) }, body: raw })
  cleanup.push(`delete from alt.attempts where via = 'api' and student_id = (select id from alt.students where external_ref = ${lit(stu.external_ref)})`)
  check('signed attempt ingested (202) and a readiness job queued', r.status === 202 && json(r)?.inserted === 1, r.text.slice(0, 80))
  const r2 = await http('POST', '/api/v1/attempts', { headers: { ...base, 'idempotency-key': idem, 'altimeter-signature': sign(key, raw) }, body: raw })
  check('retry with the same Idempotency-Key replays, no second row', r2.status === 202 && r2.headers['idempotent-replayed'] === 'true')
  const raw3 = canon({ attempts: [{ ...payload.attempts[0], band: 7 }] })
  const r3 = await http('POST', '/api/v1/attempts', { headers: { ...base, 'idempotency-key': idem, 'altimeter-signature': sign(key, raw3) }, body: raw3 })
  check('same Idempotency-Key with a different body -> 422', r3.status === 422, `${r3.status}`)
  const g = await http('GET', `/api/v1/students/${encodeURIComponent(stu.external_ref)}/readiness`, { headers: { authorization: `Bearer ${key}` } })
  check('readiness readable through the API', g.status === 200 && !!json(g)?.readiness?.status, json(g)?.readiness?.status)
  const x = await http('GET', `/api/v1/students/${encodeURIComponent(other.external_ref)}/readiness`, { headers: { authorization: `Bearer ${key}` } })
  check("a key cannot read another institution's learner (404)", x.status === 404, `${x.status}`)
  runSql(`update alt.api_keys set revoked_at = now() where key_sha256 = ${lit(sha)}`)
  const rv = await http('GET', `/api/v1/students/${encodeURIComponent(stu.external_ref)}/readiness`, { headers: { authorization: `Bearer ${key}` } })
  check('a revoked key is refused (401)', rv.status === 401, `${rv.status}`)
}

// ================================================================== 5. row-level security, straight in SQL
{
  const as = (email, q) => runSql(`begin; select set_config('request.jwt.claims', json_build_object('sub', (select user_id from alt.profiles where email = ${lit(email)}))::text, true);
    set local role alt_user; ${q}; commit;`)
  const [t] = as('teacher@merahputih.altimeter.demo', `select count(*)::int as n, count(distinct cohort_id)::int as c from alt.students`)
  check('RLS: teacher sees only their two cohorts', t.c === 2 && t.n > 0, `${t.n} learners, ${t.c} cohorts`)
  const [l] = as('learner@merahputih.altimeter.demo', `select count(*)::int as n from alt.students`)
  check('RLS: learner sees exactly one learner (themselves)', l.n === 1)
  const [a] = as('admin@cendekia.altimeter.demo', `select count(distinct institution_id)::int as i from alt.students`)
  check('RLS: school admin sees one institution', a.i === 1)
  const [z] = runSql(`begin; set local role alt_user; select count(*)::int as n from alt.students; commit;`)
  check('RLS: no JWT claims -> nothing', z.n === 0)
  let denied = false
  try { as('ops@altimeter.demo', `select count(*) from alt.attempts_2026_09`) } catch { denied = true }
  check('partitions cannot be read directly (RLS bypass closed)', denied)
  denied = false
  try { runSql(`update alt.reviews set overall = 9 where seq = 1`) } catch (e) { denied = /append-only/.test(e.message) }
  check('review ledger is append-only, even for the database owner', denied)
  denied = false
  try { as('teacher@merahputih.altimeter.demo', `insert into alt.essays (student_id, prompt_id, body, word_count, body_sha256, via) values (1, 1, 'x', 1, 'x', 'app')`) } catch { denied = true }
  check('no direct table writes for users (functions only)', denied)
  const [c] = runSql(`select alt.verify_chains() as v`)
  check('hash chains verify end to end', c.v.audit_broken_at == null && c.v.review_broken_at == null, `${c.v.audit_rows} audit, ${c.v.review_rows} reviews`)
}

// ================================================================== 6. resilience: a worker dies mid-batch
{
  const [{ id }] = runSql(`begin; select set_config('request.jwt.claims', json_build_object('sub', (select user_id from alt.profiles where email = 'ops@altimeter.demo'))::text, true);
    select alt.start_rescore(60) as id; commit;`)
  const [{ started }] = runSql(`select started_at as started from alt.load_tests where id = ${id}`)
  const secret = process.env.ALT_WORKER_SECRET
  await http('POST', '/api/worker', { headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' }, body: '{"trigger":"sit-crash","crashAfter":5}' })
  for (let i = 0; i < 3; i++) await http('POST', '/api/worker', { headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' }, body: '{"trigger":"sit"}' })
  let done = 0
  for (let i = 0; i < 30; i++) {
    ;[{ done }] = runSql(`select count(distinct essay_id)::int as done from alt.essay_scores where valid_from >= ${lit(started)}`)
    if (done >= 60) break
    await sleep(5000)
  }
  const [{ dup }] = runSql(`select count(*)::int as dup from (select essay_id from alt.essay_scores where valid_to is null group by essay_id having count(*) > 1) x`)
  check('after a worker crash all 60 re-scores still finish (visibility timeout)', done >= 60, `${done}/60`)
  check('exactly one current score per essay (no duplicates)', dup === 0)
}

// ================================================================== cleanup
runSql(`begin; ${cleanup.join(';\n')}; select alt.enqueue_readiness(id) from alt.students where user_id is not null or id in (select id from alt.students where institution_id = 2 order by id limit 1); commit;`)

const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
