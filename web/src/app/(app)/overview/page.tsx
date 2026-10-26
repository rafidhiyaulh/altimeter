import Link from 'next/link'
import { requireMe } from '@/lib/auth'
import { asUser, n } from '@/lib/db'
import { getT, titled } from '@/lib/i18n-server'
import { cohorts } from '@/lib/queries'
import { band, date, num, pct, requestNow, signed } from '@/lib/format'
import { Card, Kpi, PageHead, Badge } from '@/components/ui'
import { StatusBar } from '@/components/charts'
import { Term } from '@/components/Help'

export const generateMetadata = titled('Ringkasan', 'Overview')

export default async function Overview() {
  const me = await requireMe(['platform', 'inst_admin', 'teacher'])
  const { t } = await getT()
  const rows = await cohorts(me)
  const [trust] = await asUser(me, tx => tx`
    select count(*)::int as reviews, avg(ai_overall - overall) as bias, avg((abs(ai_overall - overall) <= 0.5)::int) as within,
      (select entries -> 'writing:ai_writing' ->> 'a' from alt.calibrations where active) as cal_writing,
      (select created_at from alt.calibrations where active) as cal_at
    from alt.reviews where ai_overall is not null`)
  const tot = rows.reduce((a, r) => ({
    learners: a.learners + r.learners, on_track: a.on_track + r.on_track, watch: a.watch + r.watch, at_risk: a.at_risk + r.at_risk,
    insufficient_data: a.insufficient_data + r.insufficient_data, newly: a.newly + r.newly_at_risk, reviews: a.reviews + r.reviews_open,
    active: a.active + r.active_14d,
  }), { learners: 0, on_track: 0, watch: 0, at_risk: 0, insufficient_data: 0, newly: 0, reviews: 0, active: 0 })
  const forecastable = tot.learners - tot.insufficient_data
  const weeks = (d: string) => Math.max(0, Math.round((new Date(d).getTime() - requestNow()) / (7 * 86400000)))

  return (
    <>
      <PageHead
        title={me.role === 'platform' ? t('Semua institusi', 'All institutions') : (me.institution ?? '')}
        sub={t('Siapa lulus target, siapa dibantu minggu ini.', 'Who hits the target, who needs help this week.')}
      />
      <div className="kpis">
        <Kpi label={t('Learner', 'Learners')} value={num(tot.learners)} sub={`${num(tot.active)} ${t('aktif 14 hari terakhir', 'active in the last 14 days')}`} />
        <Kpi label={t('Sesuai jalur', 'On track')} term="p_target" keyColor="var(--chart-good)" value={pct(forecastable ? tot.on_track / forecastable : null)}
          sub={`${num(tot.on_track)} ${t('dari', 'of')} ${num(forecastable)} ${t('yang bisa diperkirakan', 'with a forecast')}`} />
        <Kpi label={t('Berisiko', 'At risk')} keyColor="var(--chart-bad)" value={num(tot.at_risk)}
          sub={tot.newly > 0 ? `${num(tot.newly)} ${t('baru dalam 7 hari', 'new in the last 7 days')}` : t('tidak ada yang baru minggu ini', 'none new this week')} tone={tot.newly > 0 ? 'bad' : undefined} />
        <Kpi label={t('Esai menunggu review', 'Essays awaiting review')} term="audit" value={num(tot.reviews)} href="/review" />
        <Kpi label={t('AI vs guru ±0,5', 'AI vs teacher ±0.5')} term="within_half" value={pct(n(trust?.within))}
          sub={`${t('bias', 'bias')} ${signed(n(trust?.bias), 2)} ${t('band', 'band')} · n=${num(trust?.reviews)}`} href="/trust" />
      </div>

      <Card title={t('Kohort', 'Cohorts')} sub={t('Urut deadline terdekat.', 'Nearest deadline first.')} pad={false}>
        <div className="table-wrap">
          <table className="data">
            <thead><tr>
              <th>{t('Kohort', 'Cohort')}</th>
              <th className="num">{t('Target', 'Target')}</th>
              <th>{t('Deadline', 'Deadline')}</th>
              <th className="num">{t('Learner', 'Learners')}</th>
              <th style={{ minWidth: 220 }}><Term k="readiness">{t('Status kesiapan', 'Readiness')}</Term></th>
              <th className="num"><Term k="p_target">{t('Median peluang', 'Median chance')}</Term></th>
              <th className="num">{t('Baru berisiko', 'Newly at risk')}</th>
            </tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  <td>
                    <Link className="row-link" href={`/cohorts/${r.id}`}>{r.name}</Link>
                    {me.role === 'platform' && <div className="muted small">{r.institution}</div>}
                  </td>
                  <td className="num">{band(r.target_overall)} <span className="muted small">/ {t('min', 'min')} {band(r.target_min_skill)}</span></td>
                  <td>{date(r.deadline)} <div className="muted small">{weeks(r.deadline)} {t('minggu lagi', 'weeks left')}</div></td>
                  <td className="num">{num(r.learners)}</td>
                  <td><StatusBar c={r} legend={false} /><div className="muted small" style={{ marginTop: 4 }}>
                    {num(r.on_track)} {t('sesuai', 'on track')} · {num(r.watch)} {t('pantau', 'watch')} · {num(r.at_risk)} {t('berisiko', 'at risk')}</div></td>
                  <td className="num">{pct(r.median_p)}</td>
                  <td className="num">{r.newly_at_risk > 0 ? <Badge tone="bad">{num(r.newly_at_risk)}</Badge> : <span className="muted">0</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="cols-even" style={{ marginTop: 16 }}>
        <Card title={t('Semua learner', 'All learners')}>
          <StatusBar c={{ on_track: tot.on_track, watch: tot.watch, at_risk: tot.at_risk, insufficient_data: tot.insufficient_data }} height={14} />
          <p className="muted" style={{ marginTop: 12, fontSize: 12.5 }}>
            {t('Data kurang = ada skill tanpa skor. Minta satu mock test.', 'No data = a skill has no score. Ask for one mock test.')}
          </p>
        </Card>
        <Card title={t('Kepercayaan skor', 'Score trust')} right={<Link href="/trust" className="btn btn-sm">{t('Detail', 'Details')}</Link>}>
          <ul className="divided">
            <li className="row between"><span><Term k="audit">{t('Esai yang dinilai ulang guru', 'Essays re-marked by teachers')}</Term></span><b className="num">{num(trust?.reviews)}</b></li>
            <li className="row between"><span><Term k="bias">{t('Rata-rata AI dikurangi guru', 'Average AI minus teacher')}</Term></span><b className="num">{signed(n(trust?.bias), 2)} {t('band', 'band')}</b></li>
            <li className="row between"><span><Term k="calibration">{t('Koreksi aktif AI writing', 'Active AI writing correction')}</Term></span>
              <b className="num">{trust?.cal_writing != null ? `${signed(Number(trust.cal_writing), 2)} ${t('band', 'band')}` : t('belum ada', 'none yet')}</b></li>
          </ul>
          {trust?.cal_writing == null && (
            <p className="note" style={{ marginTop: 12 }}>
              {t('Belum ada kalibrasi. Jalankan di Kepercayaan skor.', 'No calibration yet. Run it on Score trust.')}
            </p>
          )}
        </Card>
      </div>
    </>
  )
}
