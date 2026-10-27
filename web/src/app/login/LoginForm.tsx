'use client'

import { useActionState } from 'react'
import { signIn } from './actions'
import { useT } from '@/components/Lang'
import { Building2, GraduationCap, ShieldCheck } from 'lucide-react'

export function LoginForm({ demo }: { demo: boolean }) {
  const { t } = useT()
  const [state, action, pending] = useActionState(signIn, null)
  const ROLES = [
    { k: 'platform', i: ShieldCheck, t: t('Tim Acsent', 'Acsent team'), h: t('Semua institusi, kepercayaan skor, sistem', 'All institutions, score trust, system') },
    { k: 'admin', i: Building2, t: t('Admin institusi', 'Institution admin'), h: t('Kohort, antrean, review esai', 'Cohorts, queue, essay review') },
    { k: 'learner', i: GraduationCap, t: t('Learner', 'Learner'), h: t('Kesiapan saya, tulis esai', 'My readiness, write an essay') },
  ]
  const err = state?.error === 'limited' ? t('Terlalu banyak percobaan. Coba lagi beberapa menit lagi.', 'Too many attempts. Try again in a few minutes.')
    : state?.error === 'missing' ? t('Isi email dan kata sandi.', 'Enter email and password.')
    : state?.error ? t('Gagal masuk. Periksa kredensial.', 'Sign-in failed. Check the credentials.') : null
  return (
    <form action={action} className="stack">
      {demo && (
        <div className="choice" style={{ gridTemplateColumns: '1fr' }}>
          {ROLES.map(r => (
            <button key={r.k} name="demo" value={r.k} disabled={pending} type="submit">
              <span className="role-ico" aria-hidden><r.i size={17} strokeWidth={1.8} /></span>
              <span><span className="t">{r.t}</span><span className="h">{r.h}</span></span>
            </button>
          ))}
        </div>
      )}
      {demo && <div className="login-or">{t('atau masuk dengan email', 'or sign in with email')}</div>}
      <label className="field"><span>Email</span><input className="input" style={{ width: '100%' }} name="email" type="email" autoComplete="username" /></label>
      <label className="field"><span>{t('Kata sandi', 'Password')}</span><input className="input" style={{ width: '100%' }} name="password" type="password" autoComplete="current-password" /></label>
      <button className="btn btn-primary btn-block" disabled={pending} type="submit">{pending ? t('Masuk...', 'Signing in...') : t('Masuk', 'Sign in')}</button>
      {err && <p className="alert" role="alert">{err}</p>}
    </form>
  )
}
