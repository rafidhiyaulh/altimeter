import { redirect } from 'next/navigation'
import { getMe } from '@/lib/auth'
import { getT } from '@/lib/i18n-server'
import { LoginForm } from './LoginForm'
import { LangToggle } from '@/components/Lang'
import { Mark } from '@/components/Shell'

export const metadata = { title: 'Sign in · Altimeter' }

export default async function Login() {
  if (await getMe()) redirect('/')
  const { t } = await getT()
  return (
    <div className="login-split">
      <div className="login-hero">
        <div className="login-top"><LangToggle /></div>
        <div className="alt-hero">
          <div className="alt-hero-mark"><Mark size={44} /></div>
          <h1>Altimeter</h1>
          <p className="lead">{t('Siapa yang akan lulus target, siapa yang dibantu minggu ini, dan seberapa akurat skor AI.', 'Who will hit their target, who needs help this week, and how accurate the AI scores are.')}</p>
          <ul className="alt-hero-points">
            <li><b>{t('Kesiapan', 'Readiness')}</b> {t('per learner', 'per learner')}</li>
            <li><b>{t('Kepercayaan skor', 'Score trust')}</b> {t('AI vs guru vs tes resmi', 'AI vs teacher vs official')}</li>
            <li><b>{t('Privasi', 'Privacy')}</b> {t('izin wali, hapus otomatis', 'guardian consent, auto-delete')}</li>
          </ul>
        </div>
      </div>
      <div className="login-form">
        <div className="login-box">
          <h2 className="page-title" style={{ marginBottom: 4 }}>{t('Masuk', 'Sign in')}</h2>
          <p className="muted" style={{ marginBottom: 20 }}>{t('Pilih peran demo.', 'Pick a demo role.')}</p>
          <LoginForm demo={process.env.ALT_DEMO_LOGIN !== '0'} />
        </div>
      </div>
    </div>
  )
}
