import { requireMe } from '@/lib/auth'
import { getT, titled } from '@/lib/i18n-server'
import { Card, PageHead } from '@/components/ui'

export const generateMetadata = titled('Mengapa Altimeter', 'Why Altimeter')

export default async function About() {
  await requireMe()
  const { t } = await getT()
  const BENCH = [
    ['Riiid · Santa', t('Prediksi skor dari diagnostik singkat', 'Predicted score from a short diagnostic'), t('Peluang lulus + rentang + backtest', 'Chance to pass + range + backtest')],
    ['Duolingo English Test', t('Akurasi AI dipublikasikan (technical manual)', 'Publishes AI accuracy (technical manual)'), t('Halaman Kepercayaan skor', 'Score trust page')],
    ['ELSA · School', t('Dashboard sekolah, SSO, API', 'School dashboard, SSO, API'), t('Konsol kohort + API bertanda tangan', 'Cohort console + signed API')],
    ['Cambridge W&I', t('Progres kelas per CEFR', 'Class progress by CEFR'), t('Celah skill per kohort', 'Skill gaps per cohort')],
    ['British Council', t('40 mock AI gratis saat booking', '40 free AI mocks on booking'), t('Pembeda: hasil terbukti, bukan sekadar AI', 'Edge: proven outcomes, not just AI')],
    ['Prep Edu', t('US$7 jt, masuk Indonesia, platform institusi', 'US$7M, entering Indonesia, institution platform'), t('Keunggulan lokal yang terukur', 'A measurable local edge')],
    ['Kaplan / Manhattan', t('Garansi skor', 'Score guarantee'), t('Garansi dihitung dari peluang terkalibrasi', 'Guarantee priced on calibrated chances')],
  ]
  return (
    <>
      <PageHead title={t('Mengapa Altimeter', 'Why Altimeter')} sub={t('Untuk sisi B2B Acsent.', "For Acsent's B2B side.")} />
      <div className="cols-even">
        <Card title={t('Tiga pertanyaan pembeli institusi', 'Three questions institutions ask')}>
          <ol style={{ listStyle: 'decimal', paddingLeft: 18 }} className="stack">
            <li>{t('Siapa lulus target sebelum deadline?', 'Who will hit the target by the deadline?')}</li>
            <li>{t('Seberapa akurat skor AI?', 'How accurate are the AI scores?')}</li>
            <li>{t('Apakah data anak aman?', "Is children's data safe?")}</li>
          </ol>
        </Card>
        <Card title={t('Nyata vs sintetis', 'Real vs synthetic')}>
          <ul className="stack" style={{ listStyle: 'disc', paddingLeft: 18 }}>
            <li>{t('Nyata: 2.224 esai, model, antrean, API, keamanan.', 'Real: 2,224 essays, model, queue, API, security.')}</li>
            <li>{t('Sintetis: institusi, learner, nilai guru, tes resmi.', 'Synthetic: institutions, learners, teacher marks, official results.')}</li>
          </ul>
        </Card>
      </div>
      <Card title={t('Benchmark', 'Benchmarks')} pad={false} className="anchor">
        <div className="table-wrap"><table className="data bench">
          <thead><tr><th>{t('Pemain', 'Player')}</th><th>{t('Mereka', 'They')}</th><th>Altimeter</th></tr></thead>
          <tbody>{BENCH.map(b => <tr key={b[0]}><td>{b[0]}</td><td>{b[1]}</td><td>{b[2]}</td></tr>)}</tbody>
        </table></div>
      </Card>
      <div className="cols-even" style={{ marginTop: 16 }}>
        <Card title={t('Pasar bergerak', 'Market shifts')}>
          <ul className="stack" style={{ listStyle: 'disc', paddingLeft: 18 }}>
            <li>{t('TOEFL iBT skala 1-6 sejak Jan 2026', 'TOEFL iBT on a 1-6 scale since Jan 2026')}</li>
            <li>{t('LPDP terima Duolingo English Test (2026)', 'LPDP accepts the Duolingo English Test (2026)')}</li>
            <li>{t('Kampus pakai TOEFL ITP untuk syarat lulus', 'Campuses use TOEFL ITP to graduate')}</li>
          </ul>
        </Card>
        <Card title={t('Berikutnya', 'Next')}>
          <ol style={{ listStyle: 'decimal', paddingLeft: 18 }} className="stack">
            <li>{t('Speaking (speechocean762)', 'Speaking (speechocean762)')}</li>
            <li>{t('TOEFL iBT 2026, DET, ITP', 'TOEFL iBT 2026, DET, ITP')}</li>
            <li>{t('Placement test adaptif (IRT)', 'Adaptive placement test (IRT)')}</li>
            <li>{t('Garansi skor, SSO sekolah', 'Score guarantee, school SSO')}</li>
          </ol>
        </Card>
      </div>
    </>
  )
}
