import { requireMe } from '@/lib/auth'
import { getT, titled } from '@/lib/i18n-server'
import { Card, PageHead } from '@/components/ui'
import { FeatureCard } from '@/components/ui/feature-card'

export const generateMetadata = titled('Mengapa Altimeter', 'Why Altimeter')

export default async function About() {
  await requireMe()
  const { t } = await getT()
  const BENCH = [
    ['Riiid Santa', t('Prediksi skor dari diagnostik singkat', 'Predicted score from a short diagnostic'), t('Peluang lulus dengan rentang, diuji ke data lama', 'Chance to pass with a range, tested on past data')],
    ['Duolingo English Test', t('Akurasi AI dipublikasikan (technical manual)', 'Publishes AI accuracy (technical manual)'), t('Akurasi AI terlihat langsung oleh sekolah', 'AI accuracy visible to every school')],
    ['ELSA for Schools', t('Dashboard sekolah, SSO, API', 'School dashboard, SSO, API'), t('Dashboard kohort dan API yang aman', 'A cohort dashboard and a secure API')],
    ['Cambridge W&I', t('Progres kelas per CEFR', 'Class progress by CEFR'), t('Celah skill per kohort', 'Skill gaps per cohort')],
    ['British Council', t('40 mock AI gratis saat booking', '40 free AI mocks on booking'), t('Bukti hasil, bukan hanya AI gratis', 'Proof of results, not just free AI')],
    ['Prep Edu', t('US$7 jt, masuk Indonesia, platform institusi', 'US$7M, entering Indonesia, institution platform'), t('Keunggulan lokal yang bisa diukur', 'A local edge that can be measured')],
    ['Kaplan / Manhattan', t('Garansi skor', 'Score guarantee'), t('Garansi dihitung dari peluang terkalibrasi', 'Guarantee priced on calibrated chances')],
  ]
  return (
    <>
      <PageHead title={t('Mengapa Altimeter', 'Why Altimeter')} sub={t('Tiga pertanyaan yang dijawab Altimeter untuk sekolah dan lembaga kursus.', 'Three questions Altimeter answers for schools and course centres.')} />
      <div className="cols-even">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <FeatureCard src="/img/cohort.jpg" alt={t('Mahasiswa belajar bersama', 'Students studying together')} label={t('Kesiapan', 'Readiness')}
            title={t('Siapa lulus target sebelum deadline?', 'Who hits the target by the deadline?')} text={t('Daftar siapa yang dibantu tiap minggu.', 'A weekly list of who to help.')} />
          <FeatureCard src="/img/writing.jpg" alt={t('Menulis esai', 'Writing an essay')} label={t('Kepercayaan skor', 'Score trust')}
            title={t('Seberapa akurat skor AI?', 'How accurate are the AI scores?')} text={t('Dicek guru dan tes resmi.', 'Checked by teachers and official tests.')} />
          <FeatureCard src="/img/learner.jpg" alt={t('Learner dengan laptop', 'A learner with a laptop')} label={t('Privasi', 'Privacy')}
            title={t('Apakah data anak aman?', "Is children's data safe?")} text={t('Izin wali, hapus otomatis.', 'Guardian consent, auto-delete.')} />
        </div>
        <Card title={t('Apa yang nyata di demo ini', 'What is real in this demo')}>
          <ul className="stack" style={{ listStyle: 'disc', paddingLeft: 18 }}>
            <li>{t('Nyata: 2.224 esai siswa dari dataset publik, model penilai, antrean, API, dan keamanan.', 'Real: 2,224 student essays from a public dataset, the scoring model, queue, API and security.')}</li>
            <li>{t('Dibuat untuk demo: institusi, learner, nilai guru, dan hasil tes resmi.', 'Made up for the demo: schools, learners, teacher marks and official results.')}</li>
          </ul>
          <div className="kv c2" style={{ marginTop: 16 }}>
            <div><div className="k">{t('Esai asli', 'Real essays')}</div><div className="v">2.224</div></div>
            <div><div className="k">{t('Learner sintetis', 'Synthetic learners')}</div><div className="v">450</div></div>
            <div><div className="k">{t('Tes otomatis di server live', 'Automated tests on the live site')}</div><div className="v">54/54</div></div>
            <div><div className="k">{t('Model Python sama dengan app', 'Python model matches the app')}</div><div className="v">&lt; 1e-9</div></div>
          </div>
        </Card>
      </div>
      <Card title={t('Benchmark', 'Benchmarks')} pad={false} className="anchor">
        <div className="table-wrap"><table className="data bench">
          <thead><tr><th>{t('Siapa', 'Who')}</th><th>{t('Yang mereka lakukan', 'What they do')}</th><th>{t('Yang ditambah Altimeter', 'What Altimeter adds')}</th></tr></thead>
          <tbody>{BENCH.map(b => <tr key={b[0]}><td>{b[0]}</td><td>{b[1]}</td><td>{b[2]}</td></tr>)}</tbody>
        </table></div>
      </Card>
      <div className="cols-even" style={{ marginTop: 16 }}>
        <Card title={t('Yang berubah di pasar', 'What is changing')}>
          <ul className="stack" style={{ listStyle: 'disc', paddingLeft: 18 }}>
            <li>{t('TOEFL iBT skala 1-6 sejak Jan 2026', 'TOEFL iBT on a 1-6 scale since Jan 2026')}</li>
            <li>{t('LPDP terima Duolingo English Test (2026)', 'LPDP accepts the Duolingo English Test (2026)')}</li>
            <li>{t('Kampus pakai TOEFL ITP untuk syarat lulus', 'Campuses use TOEFL ITP to graduate')}</li>
          </ul>
        </Card>
        <Card title={t('Berikutnya', 'Next')}>
          <ol style={{ listStyle: 'decimal', paddingLeft: 18 }} className="stack">
            <li>{t('Skor speaking', 'Speaking scores')}</li>
            <li>{t('TOEFL iBT 2026, Duolingo, TOEFL ITP', 'TOEFL iBT 2026, Duolingo, TOEFL ITP')}</li>
            <li>{t('Tes penempatan adaptif', 'Adaptive placement test')}</li>
            <li>{t('Garansi skor dan login sekolah', 'Score guarantee and school sign-in')}</li>
          </ol>
        </Card>
      </div>
    </>
  )
}
