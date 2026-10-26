import { requireMe } from '@/lib/auth'
import { getT, titled } from '@/lib/i18n-server'
import { Card, PageHead } from '@/components/ui'
import { FeatureCard } from '@/components/ui/feature-card'

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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <FeatureCard src="/img/cohort.jpg" alt={t('Mahasiswa belajar bersama', 'Students studying together')} label={t('Kesiapan', 'Readiness')}
            title={t('Siapa lulus target sebelum deadline?', 'Who hits the target by the deadline?')} text={t('Antrean intervensi mingguan.', 'A weekly intervention queue.')} />
          <FeatureCard src="/img/writing.jpg" alt={t('Menulis esai', 'Writing an essay')} label={t('Kepercayaan skor', 'Score trust')}
            title={t('Seberapa akurat skor AI?', 'How accurate are the AI scores?')} text={t('Dicek guru dan tes resmi.', 'Checked by teachers and official tests.')} />
          <FeatureCard src="/img/learner.jpg" alt={t('Learner dengan laptop', 'A learner with a laptop')} label={t('Privasi', 'Privacy')}
            title={t('Apakah data anak aman?', "Is children's data safe?")} text={t('Izin wali, hapus otomatis.', 'Guardian consent, auto-delete.')} />
        </div>
        <Card title={t('Nyata vs sintetis', 'Real vs synthetic')}>
          <ul className="stack" style={{ listStyle: 'disc', paddingLeft: 18 }}>
            <li>{t('Nyata: 2.224 esai, model, antrean, API, keamanan.', 'Real: 2,224 essays, model, queue, API, security.')}</li>
            <li>{t('Sintetis: institusi, learner, nilai guru, tes resmi.', 'Synthetic: institutions, learners, teacher marks, official results.')}</li>
          </ul>
          <div className="kv c2" style={{ marginTop: 16 }}>
            <div><div className="k">{t('Esai asli', 'Real essays')}</div><div className="v">2.224</div></div>
            <div><div className="k">{t('Learner sintetis', 'Synthetic learners')}</div><div className="v">450</div></div>
            <div><div className="k">{t('Uji integrasi produksi', 'Production integration tests')}</div><div className="v">54/54</div></div>
            <div><div className="k">{t('Paritas TS ↔ Python', 'TS ↔ Python parity')}</div><div className="v">&lt; 1e-9</div></div>
          </div>
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
