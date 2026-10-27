// Make the demo look like a running deployment: run calibration as the platform team (every forecast is
// recomputed through the queue) and draft this week's report for each cohort in both languages.
// usage: node --env-file=../.env.local scripts/demo-prime.mjs https://altimeter-readiness.vercel.app
import { createClient } from '@supabase/supabase-js'

const BASE = process.argv[2]
const REF = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0]
const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } })
async function cookie(email) {
  const { data, error } = await anon.auth.signInWithPassword({ email, password: process.env.ALT_DEMO_PASSWORD })
  if (error) throw error
  const v = 'base64-' + Buffer.from(JSON.stringify(data.session)).toString('base64url')
  const name = `sb-${REF}-auth-token`
  return v.length <= 3180 ? `${name}=${v}` : v.match(/.{1,3180}/g).map((p, i) => `${name}.${i}=${p}`).join('; ')
}
const post = async (c, path, body) => {
  const r = await fetch(BASE + path, { method: 'POST', headers: { cookie: c, 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) })
  return [r.status, (await r.text()).slice(0, 160)]
}
const ops = await cookie('ops@altimeter.demo')
if (!process.argv.includes('--reports-only')) console.log('calibrate', await post(ops, '/api/ops/calibrate'))
for (const cohort of [1, 2, 3, 4, 5]) for (const lang of ['en', 'id']) console.log('report', cohort, lang, await post(ops, '/api/reports', { cohort_id: cohort, lang }))
