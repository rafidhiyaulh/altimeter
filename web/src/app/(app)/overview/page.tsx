import Link from 'next/link'
import { requireMe } from '@/lib/auth'
import { asUser, n } from '@/lib/db'
import { getT, titled } from '@/lib/i18n-server'
import { cohorts } from '@/lib/queries'
import { band, date, num, pct, requestNow, signed } from '@/lib/format'
import { Card, Kpi, PageHead } from '@/components/ui'
import { StatusBar } from '@/components/charts'
import { Term } from '@/components/Help'

export const generateMetadata = titled('Ringkasan', 'Overview')

export default async function Overview() {
  const me = await requireMe(['platform', 'inst_admin', 'teacher'])
  const { t } = await getT()
  const rows = await cohorts(me)
  const [trust] = await asUser(me, tx => tx`
    select count(*)::int as reviews, avg(ai_overall - overall) as bias, avg((abs(ai_overall - overall) <= 0.5)::int) as within
    from alt.reviews where ai_overall is not null`)
  const tot = rows.reduce((a, r) => ({
    learners: a.learners + r.learners, on_track: a.on_track + r.on_track, watch: a.watch + r.watch, at_risk: a.at_risk + r.at_risk,
    insufficient_data: a.insufficient_data + r.insufficient_data, newly: a.newly + r.newly_at_risk, reviews: a.reviews + r.reviews_open,
    active: a.active + r.active_14d,
  }), { learners: 0, on_track: 0, watch: 0, at_risk: 0, insufficient_data: 0, newly: 0, reviews: 0, active: 0 })
  const forecastable = tot.learners - tot.insufficient_data
  const weeks = (d: string) => Math.max(0, Math.round((new Date(d).getTime() - requestNow()) / (7 * 86400000)))
  const bias = n(trust?.bias)

  return (
    <>
      <PageHead
        title={me.role === 'platform' ? t('Semua institusi', 'All institutions') : t('Ringkasan', 'Overview')}
        sub={t('Siapa yang akan lulus target sebelum deadline, dan siapa yang perlu dibantu minggu ini.',
          'Who will reach their target before the deadline, and who needs help this week.')}
      />
      <div className="kpis">
        <Kpi label={t('Learner', 'Learners')} value={num(tot.learners)} sub={t(`${num(tot.active)} berlatih 2 minggu terakhir`, `${num(tot.active)} practised in the last 2 weeks`)} />
        <Kpi label={t('Sesuai jalur', 'On track')} term="p_target" value={pct(forecastable ? tot.on_track / forecastable : null)}
          sub={t(`${num(tot.on_track)} dari ${num(forecastable)} learner`, `${num(tot.on_track)} of ${num(forecastable)} learners`)} />
        <Kpi label={t('Berisiko tidak lulus', 'At risk of missing')} value={num(tot.at_risk)}
          sub={tot.newly > 0 ? t(`${num(tot.newly)} baru minggu ini`, `${num(tot.newly)} new this week`) : t('tidak ada yang baru minggu ini', 'none new this week')} />
        <Kpi label={t('Esai untuk dicek', 'Essays to check')} term="audit" value={num(tot.reviews)} href="/review" />
        <Kpi label={t('AI sesuai guru', 'AI matches teachers')} term="within_half" value={pct(n(trust?.within))}
          sub={bias == null ? undefined : bias > 0.05 ? t(`AI rata-rata ${signed(bias, 2)} band lebih tinggi`, `AI is ${signed(bias, 2)} band high on average`)
            : bias < -0.05 ? t(`AI rata-rata ${signed(bias, 2)} band lebih rendah`, `AI is ${signed(bias, 2)} band low on average`) : t('tanpa selisih berarti', 'no real difference')}
          href="/trust" />
      </div>

      <Card title={t('Kohort', 'Cohorts')} sub={t('Deadline terdekat paling atas. Klik kohort untuk melihat siapa yang perlu dibantu.', 'Nearest deadline first. Open a cohort to see who needs help.')} pad={false}>
        <div className="table-wrap">
          <table className="data">
            <thead><tr>
              <th>{t('Kohort', 'Cohort')}</th>
              <th className="num">{t('Target', 'Target')}</th>
              <th>{t('Deadline', 'Deadline')}</th>
              <th className="num">{t('Learner', 'Learners')}</th>
              <th style={{ minWidth: 240 }}><Term k="readiness">{t('Kesiapan', 'Readiness')}</Term></th>
              <th className="num"><Term k="p_target">{t('Peluang lulus (median)', 'Median chance')}</Term></th>
            </tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  <td>
                    <Link className="row-link" href={`/cohorts/${r.id}`}>{r.name}</Link>
                    {me.role === 'platform' && <div className="muted small">{r.institution}</div>}
                  </td>
                  <td className="num">{band(r.target_overall)}<div className="muted small">{t(`tiap skill ≥ ${band(r.target_min_skill)}`, `each skill ≥ ${band(r.target_min_skill)}`)}</div></td>
                  <td>{date(r.deadline)}<div className="muted small">{t(`${weeks(r.deadline)} minggu lagi`, `${weeks(r.deadline)} weeks left`)}</div></td>
                  <td className="num">{num(r.learners)}</td>
                  <td><StatusBar c={r} legend={false} />
                    <div className="muted small" style={{ marginTop: 5 }}>{t(`${num(r.at_risk)} berisiko, ${num(r.watch)} perlu dipantau, ${num(r.on_track)} sesuai jalur`,
                      `${num(r.at_risk)} at risk, ${num(r.watch)} to watch, ${num(r.on_track)} on track`)}</div></td>
                  <td className="num">{pct(r.median_p)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="table-foot">
          <StatusBarLegend t={t} />
        </div>
      </Card>
    </>
  )
}

function StatusBarLegend({ t }: { t: (id: string, en: string) => string }) {
  const k = [['var(--chart-good)', t('Sesuai jalur', 'On track')], ['var(--chart-warn)', t('Perlu dipantau', 'Watch')],
    ['var(--chart-bad)', t('Berisiko', 'At risk')], ['var(--chart-neutral)', t('Belum cukup data (minta satu mock test)', 'Not enough data (ask for one mock test)')]]
  return (
    <div className="legend" style={{ padding: 0 }}>
      {k.map(([c, l]) => <span key={l} className="k"><span className="sw" style={{ background: c, width: 9, height: 9 }} />{l}</span>)}
    </div>
  )
}
