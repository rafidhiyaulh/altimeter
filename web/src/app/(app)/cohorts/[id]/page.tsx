import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireMe } from '@/lib/auth'
import { asUser, n } from '@/lib/db'
import { getT } from '@/lib/i18n-server'
import { learners, skillOf } from '@/lib/queries'
import { ago, band, date, dec, num, pct, requestNow } from '@/lib/format'
import { Badge, Card, Kpi, PageHead, Prob, ReadyBadge, Seg, SKILL_LABEL } from '@/components/ui'
import { GapBars, StatusBar } from '@/components/charts'
import { Term } from '@/components/Help'
import { LinkPager } from '@/components/Pager'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return { title: `Cohort ${(await params).id} · Altimeter` }
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
  const weeksLeft = Math.max(0, (new Date(c.deadline).getTime() - requestNow()) / (7 * 86400000))
  const min = n(c.target_min_skill)!

  // Skill gaps: share of forecastable learners whose CURRENT level is below the minimum, per skill.
  const forecastable = all.filter(r => r.skills && r.status !== 'insufficient_data')
  const gaps = (['reading', 'listening', 'writing', 'speaking'] as const).map(k => {
    const below = forecastable.filter(r => { const s = skillOf(r.skills, k); return s?.level != null && s.level < min - 0.25 }).length
    const binding = forecastable.filter(r => r.binding === k && r.status !== 'on_track').length
    return { k, below, binding, share: forecastable.length ? below / forecastable.length : 0 }
  }).sort((a, b) => b.share - a.share)

  return (
    <>
      <Link href="/overview" className="back">← {t('Ringkasan', 'Overview')}</Link>
      <PageHead title={c.name} sub={`${c.institution} · ${t('target', 'target')} ${band(c.target_overall)}, ${t('tiap skill minimal', 'every skill at least')} ${band(c.target_min_skill)} · ${t('deadline', 'deadline')} ${date(c.deadline)} (${dec(weeksLeft, 1)} ${t('minggu', 'weeks')})`} />
      <div className="kpis">
        <Kpi label={t('Learner', 'Learners')} value={num(all.length)} />
        <Kpi label={t('Berisiko', 'At risk')} keyColor="var(--chart-bad)" value={num(counts.at_risk)} href={href({ f: 'at_risk', page: 1 })} on={f === 'at_risk'} />
        <Kpi label={t('Perlu dipantau', 'Watch')} keyColor="var(--chart-warn)" value={num(counts.watch)} href={href({ f: 'watch', page: 1 })} on={f === 'watch'} />
        <Kpi label={t('Sesuai jalur', 'On track')} keyColor="var(--chart-good)" value={num(counts.on_track)} href={href({ f: 'on_track', page: 1 })} on={f === 'on_track'} />
        <Kpi label={t('Kapasitas coaching / minggu', 'Coaching slots / week')} term="capacity" value={num(cap)} />
      </div>

      <div className="cols-2">
        <Card pad={false}
          title={f === 'priority' ? t('Antrean intervensi minggu ini', "This week's intervention queue") : t('Learner', 'Learners')}
          sub={f === 'priority'
            ? t('Urut prioritas. Garis biru = batas slot minggu ini.', 'By priority. Blue line = this week\'s slot limit.')
            : undefined}
          right={<Seg active={f} items={[
            { key: 'priority', label: t('Prioritas', 'Priority'), href: href({ f: 'priority', page: 1 }) },
            { key: 'at_risk', label: t('Berisiko', 'At risk'), href: href({ f: 'at_risk', page: 1 }), count: counts.at_risk },
            { key: 'watch', label: t('Pantau', 'Watch'), href: href({ f: 'watch', page: 1 }), count: counts.watch },
            { key: 'on_track', label: t('Sesuai', 'On track'), href: href({ f: 'on_track', page: 1 }), count: counts.on_track },
            { key: 'insufficient_data', label: t('Data kurang', 'No data'), href: href({ f: 'insufficient_data', page: 1 }), count: counts.insufficient_data },
            { key: 'all', label: t('Semua', 'All'), href: href({ f: 'all', page: 1 }), count: all.length },
          ]} />}>
          <div className="table-wrap">
            <table className="data">
              <thead><tr>
                <th className="num">#</th>
                <th>{t('Learner', 'Learner')}</th>
                <th>{t('Status', 'Status')}</th>
                <th><Term k="p_target">{t('Peluang', 'Chance')}</Term></th>
                <th><Term k="binding">{t('Skill penentu', 'Binding skill')}</Term></th>
                <th className="num hide-xs"><Term k="pace">{t('Butuh vs laju / minggu', 'Needed vs pace / wk')}</Term></th>
                <th className="hide-xs">{t('Aktif terakhir', 'Last active')}</th>
              </tr></thead>
              <tbody>
                {shown.map((r, i) => {
                  const rank = (page - 1) * per + i + 1
                  const b = skillOf(r.skills, r.binding)
                  const need = b?.neededPerWeek ?? null
                  const pace = b?.slope ?? null
                  const behind = need != null && pace != null && need > pace + 0.005
                  return (
                    <tr key={r.id} className={f === 'priority' && rank === cap + 1 ? 'cap' : undefined}>
                      <td className="num muted">{rank}</td>
                      <td>
                        <Link className="row-link" href={`/learners/${r.id}`}>{r.display_name}</Link>
                        <div className="row" style={{ gap: 4, marginTop: 2 }}>
                          {r.is_minor && <Badge tone="low">{t('di bawah 18', 'under 18')}</Badge>}
                          {!r.ai_consent && <Badge tone="warn" title={t('Tanpa persetujuan AI feedback', 'No AI-feedback consent')}>{t('tanpa izin AI', 'no AI consent')}</Badge>}
                          {!r.recoverable && <Badge tone="neutral" title={t('Kenaikan yang dibutuhkan di atas yang dicapai 90% learner', 'Needed gain is above what 90% of learners manage')}>{t('sulit dikejar', 'hard to recover')}</Badge>}
                        </div>
                      </td>
                      <td><ReadyBadge status={r.status} /></td>
                      <td><Prob p={r.p_target} /></td>
                      <td>{r.binding ? <>{SKILL_LABEL(r.binding)} <span className="muted small">{band(b?.level)}</span></> : <span className="muted">-</span>}</td>
                      <td className="num hide-xs">{need == null || !Number.isFinite(need) ? '-' : (
                        <span className="pill-pace"><span className={behind ? 'pace-bad' : 'pace-ok'}>{need <= 0 ? t('sudah', 'met') : `+${need.toFixed(2)}`}</span>
                          <span className="muted small">/ {pace == null ? '-' : `${pace >= 0 ? '+' : ''}${pace.toFixed(2)}`}</span></span>)}</td>
                      <td className="hide-xs">{r.last_activity ? ago(r.last_activity) : <span className="muted">{t('belum pernah', 'never')}</span>}</td>
                    </tr>
                  )
                })}
                {shown.length === 0 && <tr><td colSpan={7} className="muted">{t('Tidak ada learner di filter ini.', 'No learners in this filter.')}</td></tr>}
              </tbody>
            </table>
          </div>
          <LinkPager page={page} total={rows.length} size={per} href={p => href({ page: p })} perHref={p => href({ per: p, page: 1 })} />
        </Card>

        <div className="stack-16">
          <Card title={t('Status kohort', 'Cohort status')}><StatusBar c={counts} height={12} /></Card>
          <Card title={t('Celah skill', 'Skill gaps')} sub={t(`Persentase learner yang level sekarang di bawah minimum ${band(min)}.`, `Share of learners whose level today is below the ${band(min)} minimum.`)}>
            <GapBars rows={gaps.map(g => ({
              label: SKILL_LABEL(g.k), value: g.share,
              note: `${pct(g.share)} · ${num(g.binding)} ${t('penentu', 'binding')}`,
              title: t(`${g.below} learner di bawah minimum; ${g.binding} learner yang belum aman terhambat skill ini`, `${g.below} learners below minimum; ${g.binding} not-yet-safe learners held back by this skill`),
            }))} />
            <p className="muted small" style={{ marginTop: 10 }}>
              {t('Skill teratas: kandidat kelas kelompok.', 'Top skill: run a group class on it.')}
            </p>
          </Card>
        </div>
      </div>
    </>
  )
}
