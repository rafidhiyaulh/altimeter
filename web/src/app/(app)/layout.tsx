import { redirect } from 'next/navigation'
import { Shell, type NavGroup } from '@/components/Shell'
import { requireMe } from '@/lib/auth'
import { asUser } from '@/lib/db'
import { getT } from '@/lib/i18n-server'
import { supabaseServer } from '@/lib/supabase/server'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await requireMe()
  const { t } = await getT()
  const [c] = await asUser(me, tx => tx`
    select (select count(*) from alt.review_queue q where q.done_at is null)::int as reviews,
           (select count(*) from alt.dsr_requests d where d.status = 'open')::int as dsr`)

  async function signOut() {
    'use server'
    const supabase = await supabaseServer()
    await supabase.auth.signOut()
    redirect('/login')
  }

  const staff = me.role !== 'student'
  const nav: NavGroup[] = staff
    ? [
        { group: t('Kesiapan', 'Readiness'), items: [
          { href: '/overview', label: t('Ringkasan', 'Overview') },
          { href: '/review', label: t('Review esai', 'Essay review'), count: c.reviews },
          { href: '/reports', label: t('Laporan kohort', 'Cohort reports') },
        ] },
        { group: t('Kepercayaan', 'Trust'), items: [
          { href: '/trust', label: t('Kepercayaan skor', 'Score trust') },
          ...(me.role !== 'teacher' ? [{ href: '/privacy', label: t('Privasi & data', 'Privacy & data'), count: c.dsr || undefined }] : []),
          ...(me.role === 'platform' ? [{ href: '/system', label: t('Sistem & API', 'System & API') }] : []),
        ] },
        { group: t('Referensi', 'Reference'), items: [
          { href: '/about', label: t('Mengapa Altimeter', 'Why Altimeter') },
          { href: '/glossary', label: t('Glosarium', 'Glossary') },
        ] },
      ]
    : [
        { group: t('Saya', 'Me'), items: [
          { href: '/me', label: t('Kesiapan saya', 'My readiness') },
          { href: '/write', label: t('Tulis esai', 'Write an essay') },
        ] },
        { group: t('Referensi', 'Reference'), items: [
          { href: '/glossary', label: t('Glosarium', 'Glossary') },
        ] },
      ]
  const scope = me.role === 'platform' ? t('Tim platform, semua institusi', 'Platform team, all institutions')
    : me.role === 'inst_admin' ? `${t('Admin', 'Admin')}, ${me.institution}`
    : me.role === 'teacher' ? `${t('Guru', 'Teacher')}, ${me.institution}`
    : `${t('Learner', 'Learner')}, ${me.institution}`
  return <Shell nav={nav} me={{ name: me.display_name, scope }} signOut={signOut}>{children}</Shell>
}
