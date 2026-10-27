import 'server-only'
import { cache } from 'react'
import { redirect } from 'next/navigation'
import { supabaseServer } from './supabase/server'
import { asUser, type Claims } from './db'

export type Role = 'platform' | 'inst_admin' | 'teacher' | 'student'
export type Me = Claims & {
  role: Role
  institution_id: number | null
  institution: string | null
  display_name: string
  student_id: number | null
}

// Verified identity for this request: Supabase checks the JWT, then the profile is read through RLS,
// so a valid token without an Altimeter profile (e.g. another app on the same project) gets nothing.
export const getMe = cache(async (): Promise<Me | null> => {
  const supabase = await supabaseServer()
  const { data } = await supabase.auth.getClaims()
  const c = data?.claims
  if (!c?.sub) return null
  const claims = { sub: c.sub, email: c.email as string | undefined }
  const [p] = await asUser(claims, tx => tx`
    select p.role, p.institution_id, p.display_name, i.name as institution,
           (select s.id from alt.students s where s.user_id = p.user_id) as student_id
    from alt.profiles p left join alt.institutions i on i.id = p.institution_id
    where p.user_id = ${c.sub}`)
  if (!p) return null
  return { ...claims, role: p.role, institution_id: p.institution_id, institution: p.institution, display_name: p.display_name, student_id: p.student_id }
})

export async function requireMe(roles?: Role[]): Promise<Me> {
  const me = await getMe()
  if (!me) redirect('/login')
  if (roles && !roles.includes(me.role)) redirect(me.role === 'student' ? '/me' : '/overview')
  return me
}

export class HttpError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code)
  }
}

export async function apiMe(roles?: Role[]): Promise<Me> {
  const me = await getMe()
  if (!me) throw new HttpError(401, 'unauthenticated')
  if (roles && !roles.includes(me.role)) throw new HttpError(403, 'forbidden')
  return me
}

// RFC 9457 problem details for every error.
export function problem(status: number, code: string, detail?: string) {
  return Response.json({ type: `https://altimeter.dev/problems/${code}`, title: code.replace(/_/g, ' '), status, detail },
    { status, headers: { 'content-type': 'application/problem+json' } })
}

export function apiError(e: unknown) {
  if (e instanceof HttpError) return problem(e.status, e.code, e.message !== e.code ? e.message : undefined)
  const pg = e as { code?: string; message?: string }
  if (pg?.code === '42501') return problem(403, 'forbidden', 'Not permitted.')
  if (pg?.code === '28000') return problem(401, 'invalid_api_key', 'Unknown or revoked API key.')
  if (pg?.code === '22023' || pg?.code === '22P02' || pg?.code === '23514') return problem(400, 'bad_request', pg.message)
  if (pg?.code === '23505') return problem(409, 'conflict', pg.message)
  console.error(e)
  return problem(500, 'internal', 'Internal error.')
}
