import { requireMe } from '@/lib/auth'
import { asUser } from '@/lib/db'
import { getT, titled } from '@/lib/i18n-server'
import { agreement, bootstrap, crossTab, type Pair } from '@/lib/agreement'
import { date, dec, num, pct, signed } from '@/lib/format'
import { Card, CRIT_LABEL, Kpi, PageHead, SKILL_LABEL } from '@/components/ui'
import { Matrix, Reliability, sourceLabel } from '@/components/charts'
import { Term } from '@/components/Help'
import { ActionButton } from '@/components/Action'
import writingEval from '@/lib/evidence/writing_eval.json'
import ellipse from '@/lib/evidence/ellipse_validation.json'
import backtest from '@/lib/evidence/readiness_backtest.json'

export const generateMetadata = titled('Kepercayaan skor', 'Score trust')

type Metric = { n: number; mae: number; exact: number; within_half: number; qwk: number }

export default async function Trust() {
  const me = await requireMe(['platform', 'inst_admin', 'teacher'])
  const { t } = await getT()
  const d = await asUser(me, async tx => {
    // the AI score in force WHEN the teacher marked (bitemporal join), per criterion
    const rev = await tx`
      select r.reason, r.overall::float8 as teacher, r.ai_overall::float8 as ai, r.tr::float8 as t_tr, r.cc::float8 as t_cc, r.lr::float8 as t_lr, r.gra::float8 as t_gra,
             s.tr::float8 as a_tr, s.cc::float8 as a_cc, s.lr::float8 as a_lr, s.gra::float8 as a_gra
      from alt.reviews r join alt.essay_scores s on s.essay_id = r.essay_id and s.valid_from <= r.created_at and (s.valid_to is null or s.valid_to > r.created_at)
      where r.ai_overall is not null`
    const pairs = await tx`select skill, source, observed::float8, official::float8 from alt.calibration_pairs() p where p.student_id = any (alt.my_students())`
    const [cal] = await tx`select id, entries, evaluation, created_at from alt.calibrations where active`
    return { rev, pairs, cal }
  })
  const P = (rows: readonly Record<string, unknown>[], a = 'ai', b = 'teacher'): Pair[] => rows.map(r => ({ ai: Number(r[a]), ref: Number(r[b]) }))
  const audit = d.rev.filter(r => r.reason === 'random_audit')
  const low = d.rev.filter(r => r.reason === 'low_confidence')
  const A = agreement(P(audit))
  const ci = bootstrap(P(audit))
  const L = agreement(P(low))
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
  const evalBy = (d.cal?.evaluation?.by_source ?? {}) as Record<string, { mae_after: number }>
  const entries = (d.cal?.entries ?? {}) as Record<string, { a: number }>
  const highLow = (v: number) => Math.abs(v) < 0.05 ? t('pas', 'on target') : v > 0 ? t('terlalu tinggi', 'too high') : t('terlalu rendah', 'too low')

  const we = writingEval as unknown as { overall: { test: Metric; test_without_band8_model_answers: Metric; baseline_mean: Metric }; prep: Record<string, number> }
  const bt = backtest as unknown as { half_1_without_calibration: Record<string, { mae: number; within_half: number }>; half_1_with_calibration: Record<string, { mae: number; within_half: number }>;
    p_target_4_weeks_ahead_with_calibration: { reliability: { mean_p: number; observed: number; n: number }[] } }

  return (
    <>
      <PageHead title={t('Kepercayaan skor', 'Score trust')}
        sub={t('Bisakah skor AI dipercaya? Kami membandingkannya dengan nilai guru dan hasil IELTS resmi, lalu mengoreksinya.',
          'Can the AI scores be trusted? We compare them with teacher marks and real IELTS results, then correct them.')} />
      <div className="kpis">
        <Kpi label={t('Esai dicek guru', 'Essays checked by teachers')} term="audit" value={num(A.n)} sub={t('dipilih acak', 'picked at random')} />
        <Kpi label={t('AI selisih ≤ 0,5 band', 'AI within 0.5 band')} term="within_half" value={pct(A.withinHalf)}
          sub={ci ? t(`kemungkinan ${pct(ci.withinHalf[0])} sampai ${pct(ci.withinHalf[1])}`, `likely ${pct(ci.withinHalf[0])} to ${pct(ci.withinHalf[1])}`) : undefined} />
        <Kpi label={t('AI dibanding guru', 'AI compared with teachers')} term="bias" value={`${signed(A.bias, 2)} band`} sub={highLow(A.bias)} />
        <Kpi label={t('Skor kesepakatan', 'Agreement score')} term="qwk" value={dec(A.qwk, 2)} sub={t('0 = acak, 1 = sempurna', '0 = chance, 1 = perfect')} />
        <Kpi label={t('Koreksi terakhir', 'Last correction')} term="calibration" value={d.cal ? date(d.cal.created_at) : t('belum ada', 'none yet')} sub={d.cal ? t('dipakai di semua perkiraan', 'used in every forecast') : undefined} />
      </div>

      <Card title={t('AI dibanding guru', 'AI compared with teachers')}
        sub={t('Guru menilai ulang esai pilihan acak tanpa melihat skor AI. Kotak di garis diagonal berarti skornya sama.',
          'Teachers re-mark randomly picked essays without seeing the AI score. Squares on the diagonal mean the same score.')}>
        <div className="cols-even" style={{ alignItems: 'start' }}>
          <div>
            <div className="subhead" style={{ marginBottom: 8 }}>{t('Baris: skor AI. Kolom: nilai guru.', 'Rows: AI score. Columns: teacher mark.')}</div>
            {A.n > 0 ? <Matrix rows={ct.bands} cols={ct.bands} get={ct.get} rowLabel="AI" colLabel={t('Guru', 'Teacher')} /> : <p className="muted">-</p>}
          </div>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>{t('Yang dibandingkan', 'Compared')}</th><th className="num">{t('Esai', 'Essays')}</th><th className="num">{t('Sama persis', 'Exact')}</th>
                <th className="num">{t('Selisih ≤ 0,5', 'Within 0.5')}</th><th className="num"><Term k="bias">{t('AI vs guru', 'AI vs teacher')}</Term></th></tr></thead>
              <tbody>
                <tr><td className="strong">{t('Skor overall', 'Overall score')}</td><td className="num">{A.n}</td><td className="num">{pct(A.exact)}</td><td className="num">{pct(A.withinHalf)}</td><td className="num">{signed(A.bias, 2)}</td></tr>
                {crit.map(c => (
                  <tr key={c.k} className="sub-row"><td>{CRIT_LABEL(c.k.toUpperCase())}</td><td className="num">{c.a.n}</td><td className="num">{pct(c.a.exact)}</td><td className="num">{pct(c.a.withinHalf)}</td><td className="num">{signed(c.a.bias, 2)}</td></tr>
                ))}
                <tr><td>{t('Esai yang AI-nya ragu', 'Essays the AI was unsure about')}</td><td className="num">{L.n}</td><td className="num">{pct(L.exact)}</td><td className="num">{pct(L.withinHalf)}</td><td className="num">{signed(L.bias, 2)}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
        <p className="muted small" style={{ marginTop: 12 }}>{t('Klaim akurasi hanya memakai sampel acak. Esai yang AI-nya ragu sengaja dipilih karena sulit.', 'Accuracy claims use the random sample only. Essays the AI was unsure about were picked because they are hard.')}</p>
      </Card>

      <Card title={t('Skor latihan dibanding hasil IELTS resmi', 'Practice scores compared with real IELTS results')}
        sub={t('Untuk learner yang sudah tes resmi: skor latihan dalam 3 minggu di sekitar tes dibandingkan dengan hasilnya.',
          'For learners who took the real test: practice scores within 3 weeks of it, compared with the result.')}
        right={me.role === 'platform' ? <ActionButton primary small url="/api/ops/calibrate">{t('Hitung ulang koreksi', 'Recalculate correction')}</ActionButton> : undefined} pad={false}>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>{t('Skill', 'Skill')}</th><th>{t('Sumber skor', 'Score source')}</th><th className="num">{t('Pasangan', 'Pairs')}</th>
              <th className="num"><Term k="bias">{t('Latihan vs resmi', 'Practice vs real')}</Term></th><th className="num">{t('Rata-rata selisih', 'Average gap')}</th>
              {d.cal && <><th className="num"><Term k="calibration">{t('Koreksi', 'Correction')}</Term></th><th className="num">{t('Selisih sesudah koreksi', 'Gap after correction')}</th></>}</tr></thead>
            <tbody>
              {calRows.map(([k, g]) => {
                const [skill, source] = k.split(':')
                const avg = g.d / g.n
                return (
                  <tr key={k}>
                    <td className="strong">{SKILL_LABEL(skill)}</td>
                    <td className="muted">{sourceLabel(source)}</td>
                    <td className="num">{num(g.n)}</td>
                    <td className="num">{signed(avg, 2)} <span className={Math.abs(avg) >= 0.15 ? 'bad small' : 'muted small'}>{highLow(avg)}</span></td>
                    <td className="num">{dec(g.ad / g.n, 2)}</td>
                    {d.cal && <><td className="num">{entries[k]?.a != null ? signed(entries[k].a, 2) : '-'}</td><td className="num">{evalBy[k] ? dec(evalBy[k].mae_after, 2) : '-'}</td></>}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="table-foot">{t('Koreksi dipelajari dari separuh learner dan diuji di separuh lainnya. Setelah disimpan, semua perkiraan dihitung ulang.',
          'The correction is learned on half the learners and tested on the other half. Once saved, every forecast is recalculated.')}</div>
      </Card>

      <h2 className="section-title">{t('Bagaimana model diuji', 'How the models were tested')}</h2>
      <p className="page-sub" style={{ marginBottom: 14 }}>{t('Diuji sekali saat pelatihan, dengan data yang tidak pernah dilihat model.', 'Tested once during training, on data the models never saw.')}</p>
      <div className="cols-even">
        <div className="stack-16">
          <Card title={t('Model penilai writing', 'Writing scorer')} sub={t('Diuji pada soal yang tidak pernah dilihat saat pelatihan.', 'Tested on prompts it never saw in training.')} pad={false}>
            <table className="data" style={{ marginTop: 4 }}>
              <thead><tr><th /><th className="num">{t('Rata-rata selisih', 'Average gap')}</th><th className="num">{t('Selisih ≤ 0,5', 'Within 0.5')}</th></tr></thead>
              <tbody>
                <tr><td className="strong">{t('Model kami', 'Our model')}</td><td className="num">{dec(we.overall.test.mae, 2)}</td><td className="num">{pct(we.overall.test.within_half)}</td></tr>
                <tr><td>{t('Tanpa esai contoh band 8', 'Without band-8 sample answers')}</td><td className="num">{dec(we.overall.test_without_band8_model_answers.mae, 2)}</td><td className="num">{pct(we.overall.test_without_band8_model_answers.within_half)}</td></tr>
                <tr><td className="muted">{t('Pembanding: selalu menebak rata-rata', 'Baseline: always guess the average')}</td><td className="num muted">{dec(we.overall.baseline_mean.mae, 2)}</td><td className="num muted">{pct(we.overall.baseline_mean.within_half)}</td></tr>
              </tbody>
            </table>
            <div className="table-foot">{t(`Dari ${num(we.prep.raw_rows)} baris data publik, ${num(we.prep.rows_kept)} esai unik tersisa setelah duplikat dibuang.`, `From ${num(we.prep.raw_rows)} public rows, ${num(we.prep.rows_kept)} unique essays remained after removing duplicates.`)}</div>
          </Card>
          <Card title={t('Dibandingkan dengan penilai manusia', 'Compared with human raters')} sub="ELLIPSE corpus (Crossley et al., 2023)">
            <div className="row" style={{ alignItems: 'baseline', gap: 10 }}><span className="big-p" style={{ fontSize: 28 }}>{dec(ellipse.spearman_model_vs_human, 2)}</span>
              <span className="muted">{t(`kesesuaian peringkat pada ${num(ellipse.n)} esai (panjang esai saja: ${dec(ellipse.spearman_length_vs_human, 2)})`, `rank agreement on ${num(ellipse.n)} essays (essay length alone: ${dec(ellipse.spearman_length_vs_human, 2)})`)}</span></div>
            <p className="note" style={{ marginTop: 12 }}>{t('Cukup, tapi belum tinggi. Karena itu skor AI selalu dicek guru dan dikoreksi dengan hasil resmi.', 'Moderate, not high. That is why AI scores are always checked by teachers and corrected with real results.')}</p>
          </Card>
        </div>
        <Card title={t('Uji perkiraan kesiapan', 'Readiness forecast test')} sub={t('Learner contoh, esai dan model asli.', 'Sample learners, real essays and model.')} pad={false}>
          <table className="data" style={{ marginTop: 4 }}>
            <thead><tr><th>Writing</th><th className="num">{t('Rata-rata selisih', 'Average gap')}</th><th className="num">{t('Selisih ≤ 0,5', 'Within 0.5')}</th></tr></thead>
            <tbody>
              <tr><td>{t('Tanpa koreksi', 'Without correction')}</td><td className="num">{dec(bt.half_1_without_calibration.writing.mae, 2)}</td><td className="num">{pct(bt.half_1_without_calibration.writing.within_half)}</td></tr>
              <tr><td className="strong">{t('Dengan koreksi', 'With correction')}</td><td className="num">{dec(bt.half_1_with_calibration.writing.mae, 2)}</td><td className="num">{pct(bt.half_1_with_calibration.writing.within_half)}</td></tr>
            </tbody>
          </table>
          <div className="card-pad">
            <div className="subhead" style={{ marginBottom: 6 }}>{t('Apakah "peluang lulus" bisa dipercaya?', 'Can the "chance to pass" be trusted?')}</div>
            <Reliability rows={bt.p_target_4_weeks_ahead_with_calibration.reliability} />
            <p className="muted small" style={{ marginTop: 8 }}>{t('Titik dekat garis putus-putus berarti peluang yang diperkirakan sesuai dengan yang benar-benar terjadi, 4 minggu sebelum tes.',
              'Dots close to the dashed line mean the predicted chance matched what really happened, 4 weeks before the test.')}</p>
          </div>
        </Card>
      </div>
    </>
  )
}
