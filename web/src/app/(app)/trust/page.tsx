import { requireMe } from '@/lib/auth'
import { asUser } from '@/lib/db'
import { getT, titled } from '@/lib/i18n-server'
import { agreement, bootstrap, crossTab, type Pair } from '@/lib/agreement'
import { dateTime, dec, num, pct, signed } from '@/lib/format'
import { Card, Kpi, PageHead, SKILL_LABEL } from '@/components/ui'
import { Matrix, Reliability, sourceLabel } from '@/components/charts'
import { Term } from '@/components/Help'
import { ActionButton } from '@/components/Action'
import writingEval from '@/lib/evidence/writing_eval.json'
import ellipse from '@/lib/evidence/ellipse_validation.json'
import backtest from '@/lib/evidence/readiness_backtest.json'

export const generateMetadata = titled('Kepercayaan skor', 'Score trust')

type Metric = { n: number; mae: number; exact: number; within_half: number; qwk: number; spearman: number }

export default async function Trust() {
  const me = await requireMe(['platform', 'inst_admin', 'teacher'])
  const { t } = await getT()
  const d = await asUser(me, async tx => {
    // AI score in force WHEN the teacher marked (bitemporal join), per criterion.
    const rev = await tx`
      select r.reason, r.overall::float8 as teacher, r.ai_overall::float8 as ai, r.tr::float8 as t_tr, r.cc::float8 as t_cc, r.lr::float8 as t_lr, r.gra::float8 as t_gra,
             s.tr::float8 as a_tr, s.cc::float8 as a_cc, s.lr::float8 as a_lr, s.gra::float8 as a_gra
      from alt.reviews r join alt.essay_scores s on s.essay_id = r.essay_id and s.valid_from <= r.created_at and (s.valid_to is null or s.valid_to > r.created_at)
      where r.ai_overall is not null`
    const pairs = await tx`select skill, source, observed::float8, official::float8 from alt.calibration_pairs() p where p.student_id = any (alt.my_students())`
    const [cal] = await tx`select id, entries, evaluation, created_at from alt.calibrations where active`
    return { rev, pairs, cal }
  })
  const audit = d.rev.filter(r => r.reason === 'random_audit')
  const low = d.rev.filter(r => r.reason === 'low_confidence')
  const P = (rows: readonly Record<string, unknown>[], a = 'ai', b = 'teacher'): Pair[] => rows.map(r => ({ ai: Number(r[a]), ref: Number(r[b]) }))
  const aAudit = agreement(P(audit))
  const ciAudit = bootstrap(P(audit))
  const aLow = agreement(P(low))
  const ct = crossTab(P(audit))
  const crit = (['tr', 'cc', 'lr', 'gra'] as const).map(k => ({ k, a: agreement(P(audit, `a_${k}`, `t_${k}`)) }))

  const groups = new Map<string, { n: number; d: number; ad: number }>()
  for (const p of d.pairs) {
    const k = `${p.skill}:${p.source}`
    const g = groups.get(k) ?? { n: 0, d: 0, ad: 0 }
    g.n++; g.d += p.observed - p.official; g.ad += Math.abs(p.observed - p.official)
    groups.set(k, g)
  }
  const calRows = [...groups.entries()].sort((a, b) => Math.abs(b[1].d / b[1].n) - Math.abs(a[1].d / a[1].n))
  const evalBy = (d.cal?.evaluation?.by_source ?? {}) as Record<string, { n: number; bias_before: number; mae_before: number; bias_after: number; mae_after: number }>
  const ci = (k: 'withinHalf' | 'mae' | 'bias' | 'qwk', f: (x: number) => string) => ciAudit ? ` (${f(ciAudit[k][0])} – ${f(ciAudit[k][1])})` : ''

  const we = writingEval as unknown as { overall: { test: Metric; test_without_band8_model_answers: Metric; baseline_mean: Metric }; criteria: Record<string, { test: Metric; baseline_length_only: Metric }>;
    prep: Record<string, number>; conformal: { q80: number; q90: number; test_coverage_90: number }; version: string }
  const bt = backtest as unknown as { half_1_without_calibration: Record<string, { mae: number; bias: number; within_half: number }>; half_1_with_calibration: Record<string, { mae: number; bias: number; within_half: number }>;
    p_target_4_weeks_ahead_without_calibration: { brier: number }; p_target_4_weeks_ahead_with_calibration: { brier: number; n: number; reliability: { mean_p: number; observed: number; n: number }[] }; ai_writing_minus_latent: { mean: number } }

  return (
    <>
      <PageHead title={t('Kepercayaan skor', 'Score trust')}
        sub={t('AI dibandingkan guru dan tes resmi, lalu dikoreksi.', 'AI checked against teachers and official tests, then corrected.')} />
      <div className="kpis">
        <Kpi label={t('Audit acak', 'Random audit')} term="audit" value={num(aAudit.n)} sub={t('sampel tak bias', 'unbiased sample')} />
        <Kpi label={t('AI vs guru ±0,5', 'AI vs teacher ±0.5')} term="within_half" value={pct(aAudit.withinHalf)} sub={`95% CI${ci('withinHalf', v => pct(v))}`} />
        <Kpi label={t('Bias AI', 'AI bias')} term="bias" value={`${signed(aAudit.bias, 2)}`} sub={`95% CI${ci('bias', v => signed(v, 2))}`} />
        <Kpi label="QWK" term="qwk" value={dec(aAudit.qwk, 2)} sub={`95% CI${ci('qwk', v => dec(v, 2))}`} />
        <Kpi label={t('Kalibrasi aktif', 'Active calibration')} term="calibration" value={d.cal ? `#${d.cal.id}` : t('belum ada', 'none')} sub={d.cal ? dateTime(d.cal.created_at) : undefined} />
      </div>

      <div className="cols-even">
        <Card title={t('AI vs guru: audit acak', 'AI vs teacher: random audit')}
          sub={t('Baris = AI, kolom = guru.', 'Rows = AI, columns = teacher.')}>
          {aAudit.n > 0 ? <Matrix rows={ct.bands} cols={ct.bands} get={ct.get} rowLabel="AI" colLabel={t('Guru', 'Teacher')} /> : <p className="muted">-</p>}
          <table className="data" style={{ marginTop: 14 }}>
            <thead><tr><th>{t('Sampel', 'Sample')}</th><th className="num">n</th><th className="num">{t('Sama', 'Exact')}</th><th className="num">{t('±0,5', '±0.5')}</th><th className="num">MAE</th><th className="num">{t('Bias', 'Bias')}</th><th className="num">QWK</th></tr></thead>
            <tbody>
              <tr><td><Term k="audit">{t('Audit acak (overall)', 'Random audit (overall)')}</Term></td><td className="num">{aAudit.n}</td><td className="num">{pct(aAudit.exact)}</td><td className="num">{pct(aAudit.withinHalf)}</td><td className="num">{dec(aAudit.mae, 2)}</td><td className="num">{signed(aAudit.bias, 2)}</td><td className="num">{dec(aAudit.qwk, 2)}</td></tr>
              {crit.map(c => (
                <tr key={c.k}><td className="muted">· {c.k.toUpperCase()}</td><td className="num">{c.a.n}</td><td className="num">{pct(c.a.exact)}</td><td className="num">{pct(c.a.withinHalf)}</td><td className="num">{dec(c.a.mae, 2)}</td><td className="num">{signed(c.a.bias, 2)}</td><td className="num">{dec(c.a.qwk, 2)}</td></tr>
              ))}
              <tr><td>{t('AI kurang yakin (overall)', 'Low confidence (overall)')}</td><td className="num">{aLow.n}</td><td className="num">{pct(aLow.exact)}</td><td className="num">{pct(aLow.withinHalf)}</td><td className="num">{dec(aLow.mae, 2)}</td><td className="num">{signed(aLow.bias, 2)}</td><td className="num">{dec(aLow.qwk, 2)}</td></tr>
            </tbody>
          </table>
          <p className="muted small" style={{ marginTop: 10 }}>
            {t('Klaim akurasi hanya dari audit acak.', 'Accuracy claims use the random audit only.')}
          </p>
        </Card>

        <Card title={t('Skor latihan vs tes resmi', 'Practice scores vs the official test')}
          sub={t('Skor latihan ±21 hari dari tes resmi. Positif = terlalu tinggi.', 'Practice scores within 21 days of an official test. Positive = too high.')}
          right={me.role === 'platform' ? <ActionButton primary small url="/api/ops/calibrate">{t('Jalankan kalibrasi', 'Run calibration')}</ActionButton> : undefined}>
          <table className="data">
            <thead><tr><th>{t('Skill · sumber', 'Skill · source')}</th><th className="num">{t('Pasangan', 'Pairs')}</th><th className="num">{t('Bias', 'Bias')}</th><th className="num">MAE</th>
              {d.cal && <><th className="num">{t('Koreksi', 'Correction')}</th><th className="num">{t('MAE sesudah', 'MAE after')}</th></>}</tr></thead>
            <tbody>
              {calRows.map(([k, g]) => {
                const [skill, source] = k.split(':')
                const e = evalBy[k]
                const corr = (d.cal?.entries as Record<string, { a: number }> | undefined)?.[k]?.a
                return (
                  <tr key={k}>
                    <td>{SKILL_LABEL(skill)} <span className="muted small">· {sourceLabel(source)}</span></td>
                    <td className="num">{num(g.n)}</td>
                    <td className={`num ${Math.abs(g.d / g.n) >= 0.2 ? 'bad' : ''}`}>{signed(g.d / g.n, 2)}</td>
                    <td className="num">{dec(g.ad / g.n, 2)}</td>
                    {d.cal && <><td className="num">{corr != null ? signed(corr, 2) : '-'}</td><td className="num">{e ? `${dec(e.mae_after, 2)}` : '-'}</td></>}
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="muted small" style={{ marginTop: 10 }}>
            {t('Koreksi per skill, diuji silang. Forecast dihitung ulang.', 'Per-skill correction, cross-checked. Forecasts are recomputed.')}
          </p>
        </Card>
      </div>

      <h2 className="page-title" style={{ fontSize: 16, margin: '24px 0 4px' }}>{t('Bukti model (offline, dapat direproduksi)', 'Model evidence (offline, reproducible)')}</h2>
      <p className="page-sub" style={{ marginBottom: 12 }}>{t('Dari pelatihan, bukan data demo.', 'From training, not demo data.')}</p>
      <div className="cols-3">
        <Card title={t('Model writing', 'Writing model')} sub={`${we.version} · ${t('soal uji tak pernah dilihat', 'test prompts never seen in training')}`}>
          <table className="data">
            <thead><tr><th /><th className="num">MAE</th><th className="num">{t('±0,5', '±0.5')}</th><th className="num">QWK</th></tr></thead>
            <tbody>
              <tr><td>{t('Model, overall', 'Model, overall')}</td><td className="num">{dec(we.overall.test.mae, 2)}</td><td className="num">{pct(we.overall.test.within_half)}</td><td className="num">{dec(we.overall.test.qwk, 2)}</td></tr>
              <tr><td className="muted">{t('tanpa esai contoh band 8', 'without band-8 model answers')}</td><td className="num">{dec(we.overall.test_without_band8_model_answers.mae, 2)}</td><td className="num">{pct(we.overall.test_without_band8_model_answers.within_half)}</td><td className="num">{dec(we.overall.test_without_band8_model_answers.qwk, 2)}</td></tr>
              <tr><td className="muted">{t('Baseline: selalu rata-rata', 'Baseline: always the mean')}</td><td className="num">{dec(we.overall.baseline_mean.mae, 2)}</td><td className="num">{pct(we.overall.baseline_mean.within_half)}</td><td className="num">0</td></tr>
              <tr><td className="muted">{t('Baseline: panjang esai saja (TR)', 'Baseline: length only (TR)')}</td><td className="num">{dec(we.criteria.TR.baseline_length_only.mae, 2)}</td><td className="num">{pct(we.criteria.TR.baseline_length_only.within_half)}</td><td className="num">{dec(we.criteria.TR.baseline_length_only.qwk, 2)}</td></tr>
            </tbody>
          </table>
          <p className="muted small" style={{ marginTop: 10 }}>
            {t(`${num(we.prep.raw_rows)} baris → ${num(we.prep.rows_kept)} esai unik setelah dedup; split ulang per soal.`, `${num(we.prep.raw_rows)} rows → ${num(we.prep.rows_kept)} unique essays after dedup; re-split by prompt.`)}
          </p>
        </Card>
        <Card title={t('Validasi eksternal: penilai manusia', 'External check: human raters')} sub="ELLIPSE corpus (Crossley et al., 2023)">
          <div className="big-p">ρ {dec(ellipse.spearman_model_vs_human, 2)}</div>
          <p className="muted" style={{ marginTop: 6 }}>{t(`Korelasi dengan nilai manusia (${num(ellipse.n)} esai). Panjang saja: ${dec(ellipse.spearman_length_vs_human, 2)}.`, `Correlation with human scores (${num(ellipse.n)} essays). Length alone: ${dec(ellipse.spearman_length_vs_human, 2)}.`)}</p>
          <p className="note" style={{ marginTop: 10 }}>{t('Label korpus tampak buatan mesin, jadi audit guru dan kalibrasi wajib.', 'Corpus labels look machine-made, so teacher audit and calibration are a must.')}</p>
        </Card>
        <Card title={t('Backtest forecast kesiapan', 'Readiness forecast backtest')} sub={t('Learner sintetis, esai & model nyata', 'Synthetic learners, real essays & model')}>
          <table className="data">
            <thead><tr><th>Writing</th><th className="num">MAE</th><th className="num">{t('Bias', 'Bias')}</th><th className="num">{t('±0,5', '±0.5')}</th></tr></thead>
            <tbody>
              <tr><td>{t('Tanpa kalibrasi', 'Uncalibrated')}</td><td className="num">{dec(bt.half_1_without_calibration.writing.mae, 2)}</td><td className="num">{signed(bt.half_1_without_calibration.writing.bias, 2)}</td><td className="num">{pct(bt.half_1_without_calibration.writing.within_half)}</td></tr>
              <tr><td>{t('Dengan kalibrasi', 'Calibrated')}</td><td className="num">{dec(bt.half_1_with_calibration.writing.mae, 2)}</td><td className="num">{signed(bt.half_1_with_calibration.writing.bias, 2)}</td><td className="num">{pct(bt.half_1_with_calibration.writing.within_half)}</td></tr>
            </tbody>
          </table>
          <div className="row" style={{ alignItems: 'flex-start', marginTop: 10, gap: 12 }}>
            <Reliability rows={bt.p_target_4_weeks_ahead_with_calibration.reliability} />
            <p className="muted small" style={{ flex: 1, minWidth: 140 }}>
              <Term k="brier">Brier</Term> {t('4 minggu sebelum tes', '4 weeks before the test')}: {dec(bt.p_target_4_weeks_ahead_without_calibration.brier, 3)} → {dec(bt.p_target_4_weeks_ahead_with_calibration.brier, 3)} {t('dengan kalibrasi', 'with calibration')}.
              {' '}{t(`AI writing rata-rata ${signed(bt.ai_writing_minus_latent.mean, 2)} band terlalu tinggi.`, `AI writing scores ${signed(bt.ai_writing_minus_latent.mean, 2)} band too high on average.`)}
            </p>
          </div>
        </Card>
      </div>
    </>
  )
}
