import Link from 'next/link'
import { requireMe } from '@/lib/auth'
import { asUser } from '@/lib/db'
import { getT, titled } from '@/lib/i18n-server'
import { topLearners, type Fact, type Report } from '@/lib/report'
import { dateTime, pct } from '@/lib/format'
import { Card, Empty, PageHead, ReadyBadge, Seg, SKILL_LABEL } from '@/components/ui'
import { ActionButton } from '@/components/Action'
import { InfoTip } from '@/components/Help'
import { ChevronRight } from 'lucide-react'

export const generateMetadata = titled('Laporan kohort', 'Cohort reports')

export default async function Reports({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const me = await requireMe(['platform', 'inst_admin', 'teacher'])
  const { t, lang } = await getT()
  const cohorts = await asUser(me, tx => tx`select id, name from alt.cohorts order by deadline, id`)
  const cid = Number((await searchParams).c) || cohorts[0]?.id
  if (!cid) return <Empty>{t('Tidak ada kohort.', 'No cohorts.')}</Empty>
  const [latest] = await asUser(me, tx => tx`select r.*, p.display_name as author from alt.reports r left join alt.profiles p on p.user_id = r.created_by
    where r.cohort_id = ${cid} and r.lang = ${lang} order by r.created_at desc limit 1`)
  const history = await asUser(me, tx => tx`select id, lang, source, created_at from alt.reports where cohort_id = ${cid} order by created_at desc limit 8`)
  const top = await topLearners(me, cid, 8)
  const rep = latest?.content as Report | undefined
  const facts = (latest?.facts ?? []) as Fact[]
  const name = cohorts.find(c => c.id === cid)?.name
  return (
    <>
      <PageHead title={t('Laporan kohort mingguan', 'Weekly cohort report')} sub={t('Singkat, berbasis fakta, dua bahasa.', 'Short, fact-based, two languages.')}>
        <ActionButton primary url="/api/reports" body={{ cohort_id: cid, lang }}>{t('Susun laporan minggu ini', "Draft this week's report")} ({lang.toUpperCase()})</ActionButton>
      </PageHead>
      <div style={{ marginBottom: 16 }}><Seg active={String(cid)} items={cohorts.map(c => ({ key: String(c.id), label: c.name, href: `/reports?c=${c.id}` }))} /></div>
      <div className="cols-2">
        <Card title={rep?.headline || name} sub={latest ? t(`Dibuat ${dateTime(latest.created_at)}. ${latest.source === 'llm' ? 'Ditulis AI, setiap poin merujuk ke angka di bawah.' : 'Disusun dari aturan tetap.'}`, `Made ${dateTime(latest.created_at)}. ${latest.source === 'llm' ? 'Written by AI, every point refers to the numbers below.' : 'Built from fixed rules.'}`) : undefined}>
          {rep ? (
            <div className="stack">
              <ul className="stack" style={{ listStyle: 'disc', paddingLeft: 18 }}>
                {rep.bullets.map((b, i) => <li key={i}>{b.text}<InfoTip text={`${t('Berdasarkan', 'Based on')}: ${b.facts.map(f => facts.find(x => x.id === f)).filter(Boolean).map(x => `${x!.label.replace(/_/g, ' ')} = ${x!.value}`).join('; ')}`} /></li>)}
              </ul>
              {rep.actions.length > 0 && <><div className="subhead">{t('Aksi minggu ini', 'This week')}</div><ol style={{ listStyle: 'decimal', paddingLeft: 18 }} className="stack">{rep.actions.map((a, i) => <li key={i}>{a}</li>)}</ol></>}
              <details className="tech"><summary><ChevronRight size={14} aria-hidden />{t('Lihat angka di balik laporan ini', 'See the numbers behind this report')}</summary>
                <table className="data" style={{ marginTop: 8 }}><tbody>{facts.map(f => <tr key={f.id}><td>{f.label.replace(/_/g, ' ')}</td><td className="num">{String(f.value)}</td></tr>)}</tbody></table>
              </details>
            </div>
          ) : <p className="muted">{t('Belum ada laporan.', 'No report yet.')}</p>}
        </Card>
        <div className="stack-16">
          <Card title={t('Siapa dibantu minggu ini', 'Who to help this week')} sub={t('Diambil langsung dari data, bukan ditulis AI.', 'Taken straight from the data, not written by AI.')}>
            <ul className="divided">{top.map(l => (
              <li key={l.id} className="row between"><Link href={`/learners/${l.id}`}>{l.display_name}</Link>
                <span className="row" style={{ gap: 10 }}>{l.binding && <span className="muted small">{SKILL_LABEL(l.binding)}</span>}<span className="small num">{pct(l.p_target)}</span><ReadyBadge status={l.status} /></span></li>))}
            </ul>
          </Card>
          <Card title={t('Riwayat', 'History')}>
            <ul className="divided">{history.map(h => <li key={h.id} className="row between"><span>{h.lang === 'id' ? t('Bahasa Indonesia', 'Indonesian') : t('Bahasa Inggris', 'English')} <span className="muted small">{h.source === 'llm' ? t('ditulis AI', 'written by AI') : t('dari aturan', 'from rules')}</span></span><span className="muted small">{dateTime(h.created_at)}</span></li>)}</ul>
          </Card>
        </div>
      </div>
    </>
  )
}
