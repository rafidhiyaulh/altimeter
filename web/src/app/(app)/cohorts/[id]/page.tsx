import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { requireMe } from '@/lib/auth'
import { asUser, n } from '@/lib/db'
import { getT } from '@/lib/i18n-server'
import { learners, skillOf } from '@/lib/queries'
import { ago, band, date, num, pct, requestNow } from '@/lib/format'
import { Badge, Card, Kpi, Meta, PageHead, Prob, ReadyBadge, SKILL_LABEL } from '@/components/ui'
import { Term } from '@/components/Help'
import { LinkPager } from '@/components/Pager'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return { title: `Cohort ${(await params).id}` }
}

const FILTERS = ['priority', 'at_risk', 'watch', 'on_track', 'insufficient_data', 'all'] as const

export default async function CohortPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ f?: string; page?: string; per?: string }>
}) {
  const me = await requireMe(['platform', 'inst_admin', 'teacher'])
  const { t } = await getT()
  const id = Number((await params).id)
  const sp = await searchParams
  if (!Number.isInteger(id)) notFound()
  const [c] = await asUser(me, tx => tx`
    select c.*, c.deadline::text as deadline, i.name as institution from alt.cohorts c join alt.institutions i on i.id = c.institution_id where c.id = ${id}`)
  if (!c) notFound()
  const all = await learners(me, id)
  const f = (FILTERS as readonly string[]).includes(sp.f ?? '') ? sp.f! : 'priority'
  const rows = f === 'priority' ? all.filter(r => r.status === 'at_risk' || r.status === 'watch')
    : f === 'all' ? all : all.filter(r => (r.status ?? 'insufficient_data') === f)
  const per = [15, 30, 50].includes(Number(sp.per)) ? Number(sp.per) : 15
  const page = Math.max(1, Math.min(Math.ceil(rows.length / per) || 1, Number(sp.page) || 1))
  const shown = rows.slice((page - 1) * per, page * per)
  const cap = Number(c.weekly_capacity)
  const count = (s: string) => all.filter(r => (r.status ?? 'insufficient_data') === s).length
  const counts = { on_track: count('on_track'), watch: count('watch'), at_risk: count('at_risk'), insufficient_data: count('insufficient_data') }
  const href = (o: Record<string, string | number>) => `/cohorts/${id}?${new URLSearchParams({ f, per: String(per), ...Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v)])) })}`
  const weeksLeft = Math.max(0, Math.round((new Date(c.deadline).getTime() - requestNow()) / (7 * 86400000)))
  const min = n(c.target_min_skill)!

  // Skill gaps: share of learners whose CURRENT level is below the minimum, per skill.
  const forecastable = all.filter(r => r.skills && r.status !== 'insufficient_data')
  const gaps = (['reading', 'listening', 'writing', 'speaking'] as const).map(k => {
    const below = forecastable.filter(r => { const s = skillOf(r.skills, k); return s?.level != null && s.level < min - 0.25 }).length
    return { k, below, share: forecastable.length ? below / forecastable.length : 0 }
  }).sort((a, b) => b.share - a.share)
  const maxGap = Math.max(0.0001, ...gaps.map(g => g.share))

  const titles: Record<string, string> = {
    priority: t(`Siapa dibantu minggu ini`, 'Who to help this week'), at_risk: t('Berisiko tidak lulus', 'At risk of missing'),
    watch: t('Perlu dipantau', 'To watch'), on_track: t('Sesuai jalur', 'On track'), insufficient_data: t('Belum cukup data', 'Not enough data'), all: t('Semua learner', 'All learners'),
  }

  return (
    <>
      <Link href="/overview" className="back"><ArrowLeft size={15} aria-hidden />{t('Ringkasan', 'Overview')}</Link>
      <PageHead title={c.name} meta={<Meta items={[
        c.institution,
        <>{t('Target', 'Target')} <b>{band(c.target_overall)}</b>, {t('tiap skill minimal', 'each skill at least')} <b>{band(c.target_min_skill)}</b></>,
        <>{t('Deadline', 'Deadline')} <b>{date(c.deadline)}</b> ({t(`${weeksLeft} minggu lagi`, `${weeksLeft} weeks left`)})</>,
      ]} />} />

      <div className="kpis">
        <Kpi label={t('Perlu dibantu', 'Need help')} value={num(counts.at_risk + counts.watch)} sub={t('berisiko atau perlu dipantau', 'at risk or to watch')} href={href({ f: 'priority', page: 1 })} on={f === 'priority'} />
        <Kpi label={t('Berisiko tidak lulus', 'At risk of missing')} value={num(counts.at_risk)} href={href({ f: 'at_risk', page: 1 })} on={f === 'at_risk'} />
        <Kpi label={t('Perlu dipantau', 'To watch')} value={num(counts.watch)} href={href({ f: 'watch', page: 1 })} on={f === 'watch'} />
        <Kpi label={t('Sesuai jalur', 'On track')} value={num(counts.on_track)} href={href({ f: 'on_track', page: 1 })} on={f === 'on_track'} />
        <Kpi label={t('Belum cukup data', 'Not enough data')} value={num(counts.insufficient_data)} href={href({ f: 'insufficient_data', page: 1 })} on={f === 'insufficient_data'} />
      </div>

      <Card title={t('Skill yang paling banyak tertinggal', 'Skills most often behind')} sub={t(`Persen learner yang saat ini di bawah ${band(min)}. Skill teratas cocok untuk kelas kelompok.`, `Share of learners below ${band(min)} today. The top one is a good group class.`)} pad={false}>
        <div className="gaps" style={{ marginTop: 12, borderTop: '1px solid var(--border)' }}>
          {gaps.map(g => (
            <div key={g.k}>
              <div className="g-top"><span>{SKILL_LABEL(g.k)}</span><span className="g-val">{pct(g.share)}</span></div>
              <div className="track"><div className="fill" style={{ width: `${(g.share / maxGap) * 100}%` }} /></div>
              <div className="g-sub">{t(`${num(g.below)} learner`, `${num(g.below)} learners`)}</div>
            </div>
          ))}
        </div>
      </Card>

      <Card pad={false} title={titles[f]}
        sub={f === 'priority'
          ? t(`Paling atas = paling mungkin terbantu. Garis biru = batas ${cap} sesi coaching minggu ini.`, `Top = most likely to be helped. Blue line = this week's ${cap} coaching slots.`)
          : f === 'insufficient_data' ? t('Ada skill tanpa skor sama sekali. Minta satu mock test lengkap.', 'A skill has no score yet. Ask for one full mock test.') : undefined}
        right={f !== 'all' ? <Link href={href({ f: 'all', page: 1 })} className="btn btn-sm">{t(`Lihat semua ${all.length}`, `See all ${all.length}`)}</Link> : undefined}>
        <div className="table-wrap">
          <table className="data">
            <thead><tr>
              <th className="num">#</th>
              <th>{t('Learner', 'Learner')}</th>
              <th className="hide-xs">{t('Status', 'Status')}</th>
              <th><Term k="p_target">{t('Peluang lulus', 'Chance to pass')}</Term></th>
              <th><Term k="binding">{t('Skill paling lemah', 'Weakest skill')}</Term></th>
              <th className="num hide-xs"><Term k="pace">{t('Perlu naik / minggu', 'Needed gain / week')}</Term></th>
              <th className="num hide-xs">{t('Laju sekarang', 'Current pace')}</th>
              <th className="hide-xs">{t('Latihan terakhir', 'Last practice')}</th>
            </tr></thead>
            <tbody>
              {shown.map((r, i) => {
                const rank = (page - 1) * per + i + 1
                const b = skillOf(r.skills, r.binding)
                const need = b?.neededPerWeek ?? null
                const pace = b?.slope ?? null
                return (
                  <tr key={r.id} className={f === 'priority' && rank === cap + 1 ? 'cap' : undefined}>
                    <td className="num muted">{rank}</td>
                    <td>
                      <Link className="row-link nowrap" href={`/learners/${r.id}`}>{r.display_name}</Link>
                      {(r.is_minor || !r.ai_consent || !r.recoverable) && (
                        <div className="row" style={{ gap: 4, marginTop: 3 }}>
                          {r.is_minor && <Badge tone="low">{t('di bawah 18', 'under 18')}</Badge>}
                          {!r.ai_consent && <Badge tone="warn">{t('belum izin AI', 'no AI consent')}</Badge>}
                          {!r.recoverable && <Badge tone="neutral">{t('sulit dikejar', 'hard to catch up')}</Badge>}
                        </div>
                      )}
                    </td>
                    <td className="hide-xs"><ReadyBadge status={r.status} /></td>
                    <td><Prob p={r.p_target} /></td>
                    <td className="nowrap">{r.binding ? <>{SKILL_LABEL(r.binding)} <span className="muted">{band(b?.level)}</span></> : <span className="muted">-</span>}</td>
                    <td className="num hide-xs">{need == null || !Number.isFinite(need) ? <span className="muted">-</span> : need <= 0 ? <span className="muted">{t('sudah cukup', 'already there')}</span> : `+${need.toFixed(2)}`}</td>
                    <td className="num hide-xs muted">{pace == null ? '-' : `${pace >= 0 ? '+' : '−'}${Math.abs(pace).toFixed(2)}`}</td>
                    <td className="hide-xs nowrap">{r.last_activity ? ago(r.last_activity) : <span className="muted">{t('belum pernah', 'never')}</span>}</td>
                  </tr>
                )
              })}
              {shown.length === 0 && <tr><td colSpan={8} className="muted">{t('Tidak ada learner di sini.', 'No learners here.')}</td></tr>}
            </tbody>
          </table>
        </div>
        <LinkPager page={page} total={rows.length} size={per} href={p => href({ page: p })} perHref={p => href({ per: p, page: 1 })} />
      </Card>
    </>
  )
}
