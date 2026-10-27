// Demo accounts (Supabase Auth) + alt.profiles + teacher cohorts, and links the demo learner account to one
// learner. Idempotent. Needs NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ALT_DEMO_PASSWORD.
// The auth project is shared with other apps: these users get app_metadata.app = 'altimeter' and have no
// profile anywhere else, so they see nothing outside Altimeter.
import { createClient } from '@supabase/supabase-js'
import { runSql, lit } from './lib/dbq.mjs'

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const DEMO = [
  { email: 'ops@altimeter.demo', role: 'platform', inst: null, name: 'Platform Ops (Acsent)', cohorts: [] },
  { email: 'admin@merahputih.altimeter.demo', role: 'inst_admin', inst: 2, name: 'Ratna Wulandari, Head of Language Centre', cohorts: [] },
  { email: 'teacher@merahputih.altimeter.demo', role: 'teacher', inst: 2, name: 'Bima Santoso, IELTS Coach', cohorts: ['lpdp-7', 'predep'] },
  { email: 'learner@merahputih.altimeter.demo', role: 'student', inst: 2, name: null, cohorts: [] },
  { email: 'admin@cendekia.altimeter.demo', role: 'inst_admin', inst: 1, name: 'Dewi Kusuma, Vice Principal', cohorts: [] },
  { email: 'teacher@cendekia.altimeter.demo', role: 'teacher', inst: 1, name: 'Fajar Hidayat, English Teacher', cohorts: ['iup-a', 'iup-b'] },
  { email: 'admin@arunika.altimeter.demo', role: 'inst_admin', inst: 3, name: 'Laras Permata, Talent Development', cohorts: [] },
  { email: 'teacher@arunika.altimeter.demo', role: 'teacher', inst: 3, name: 'Kevin Halim, Language Coach', cohorts: ['oa-2027'] },
]

// The demo learner: an adult in LPDP Prep Batch 7 with consent, a few essays and a forecast worth discussing.
const [learner] = runSql(`
  select s.id, s.display_name from alt.students s join alt.cohorts c on c.id = s.cohort_id
  left join alt.readiness r on r.student_id = s.id and r.valid_to is null
  where c.key = 'lpdp-7' and s.user_id is null
    and exists (select 1 from alt.consents k where k.student_id = s.id and k.scope = 'ai_feedback' and k.revoked_at is null)
  order by (r.status = 'watch') desc, (select count(*) from alt.essays e where e.student_id = s.id) desc limit 1`)

const { data: list, error: le } = await admin.auth.admin.listUsers({ perPage: 1000 })
if (le) throw le
for (const d of DEMO) {
  let user = list.users.find(u => u.email === d.email)
  if (!user) {
    const { data, error } = await admin.auth.admin.createUser({ email: d.email, password: process.env.ALT_DEMO_PASSWORD, email_confirm: true, app_metadata: { app: 'altimeter' } })
    if (error) throw error
    user = data.user
  } else {
    await admin.auth.admin.updateUserById(user.id, { password: process.env.ALT_DEMO_PASSWORD, app_metadata: { app: 'altimeter' } })
  }
  const name = d.role === 'student' ? learner.display_name : d.name
  runSql(`
    insert into alt.profiles (user_id, email, role, institution_id, display_name)
    values (${lit(user.id)}, ${lit(d.email)}, ${lit(d.role)}, ${d.inst ?? 'null'}, ${lit(name)})
    on conflict (user_id) do update set role = excluded.role, institution_id = excluded.institution_id, display_name = excluded.display_name;
    delete from alt.teacher_cohorts where user_id = ${lit(user.id)};
    insert into alt.teacher_cohorts (user_id, cohort_id) select ${lit(user.id)}, id from alt.cohorts where key = any (${lit('{' + d.cohorts.join(',') + '}')}::text[]);
    ${d.role === 'student' ? `update alt.students set user_id = null where user_id = ${lit(user.id)}; update alt.students set user_id = ${lit(user.id)} where id = ${learner.id};` : ''}
  `)
  console.log(d.role.padEnd(10), d.email, d.role === 'student' ? `-> learner #${learner.id} ${learner.display_name}` : '')
}
