'use server'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { supabaseServer } from '@/lib/supabase/server'
import { asWorker } from '@/lib/db'

const DEMO: Record<string, string> = {
  platform: 'ops@altimeter.demo',
  admin: 'admin@merahputih.altimeter.demo',
  learner: 'learner@merahputih.altimeter.demo',
}

async function limited(key: string) {
  // brute-force guard shared by every server instance (Postgres counter)
  const ip = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local'
  const [r] = await asWorker(tx => tx`select alt.hit(${'login:' + key + ':' + ip}, 10, 300) as ok`)
  return !r.ok
}

export async function signIn(_: unknown, form: FormData) {
  const demo = String(form.get('demo') ?? '')
  const demoOn = process.env.ALT_DEMO_LOGIN !== '0'
  const email = demoOn && DEMO[demo] ? DEMO[demo] : String(form.get('email') ?? '').trim().toLowerCase()
  const password = demoOn && DEMO[demo] ? process.env.ALT_DEMO_PASSWORD! : String(form.get('password') ?? '')
  if (!email || !password) return { error: 'missing' }
  if (await limited(demo || email)) return { error: 'limited' }
  const supabase = await supabaseServer()
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) return { error: 'failed' }
  redirect('/')
}
