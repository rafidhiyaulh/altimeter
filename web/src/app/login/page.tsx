import { redirect } from 'next/navigation'
import { getMe } from '@/lib/auth'
import { getT } from '@/lib/i18n-server'
import { LoginForm } from './LoginForm'
import { LangToggle } from '@/components/Lang'
import { Mark } from '@/components/Shell'
import { FeatureCard } from '@/components/ui/feature-card'

export const metadata = { title: 'Sign in · Altimeter' }

export default async function Login() {
  if (await getMe()) redirect('/')
  const { t } = await getT()
  return (
    <div className="login-split">
      <div className="login-hero">
        <div className="login-top"><LangToggle /></div>
        <div className="alt-hero">
          <div className="alt-hero-mark"><Mark size={26} /></div>
          <h1>Altimeter</h1>
          <p className="lead">{t('Siapa yang akan lulus target, siapa yang dibantu minggu ini, dan seberapa akurat skor AI.', 'Who will hit their target, who needs help this week, and how accurate the AI scores are.')}</p>
          <div className="feature-row">
            <FeatureCard src="/img/cohort.jpg" alt={t('Kelompok mahasiswa belajar dengan laptop', 'Students studying together with laptops')}
              title={t('Siapa lulus 6,5 sebelum 14 Des?', 'Who hits 6.5 by 14 Dec?')} text={t('Peluang per learner, dengan alasannya.', 'Chance per learner, with the reason.')} label={t('Kesiapan', 'Readiness')} />
            <FeatureCard src="/img/writing.jpg" alt={t('Tangan menulis esai di kertas', 'A hand writing an essay on paper')}
              title={t('Skor AI dicek guru & tes resmi', 'AI scores checked by teachers & official tests')} text={t('Akurasi terukur, lalu dikoreksi.', 'Measured, then corrected.')} label={t('Kepercayaan skor', 'Score trust')} />
            <FeatureCard src="/img/learner.jpg" alt={t('Learner belajar dengan headphone', 'A learner studying with headphones')}
              title={t('Data anak aman', "Minors' data stays safe")} text={t('Izin wali, hapus otomatis.', 'Guardian consent, auto-delete.')} label={t('Privasi', 'Privacy')} />
          </div>
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
