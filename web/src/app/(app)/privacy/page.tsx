import Link from 'next/link'
import { requireMe } from '@/lib/auth'
import { asUser } from '@/lib/db'
import { getT, titled } from '@/lib/i18n-server'
import { date, num, pct } from '@/lib/format'
import { Badge, Card, Kpi, PageHead } from '@/components/ui'
import { ActionButton } from '@/components/Action'

export const generateMetadata = titled('Privasi & data', 'Privacy & data')

export default async function Privacy() {
  const me = await requireMe(['platform', 'inst_admin'])
  const { t } = await getT()
  const d = await asUser(me, async tx => {
    const [c] = await tx`select count(*) filter (where is_minor)::int as minors,
      count(*) filter (where is_minor and ai_consent)::int as minors_consent, count(*) filter (where not ai_consent and erased_at is null)::int as no_consent,
      count(*)::int as learners from alt.v_learner`
    const blocked = await tx`select id, display_name, is_minor from alt.v_learner where not ai_consent and erased_at is null order by is_minor desc, id limit 8`
    const policies = await tx`select * from alt.retention_policies order by keep_days`
    const runs = await tx`select * from alt.purge_runs order by id desc limit 6`
    const dsr = await tx`select d.*, s.display_name from alt.dsr_requests d join alt.students s on s.id = d.student_id order by d.status = 'open' desc, d.id desc limit 12`
    return { c, blocked, policies, runs, dsr }
  })
  const PDP = [
    [t('Data anak (Pasal 25)', "Children's data (Art. 25)"), t('Pemrosesan data anak memerlukan persetujuan orang tua/wali.', "Processing a child's data needs parent/guardian consent."), t('Izin wali per tujuan; tanpa izin, esai tidak pernah dikirim ke AI.', 'Guardian consent per purpose; without it the essay is never sent to AI.')],
    [t('Data spesifik (Pasal 4)', 'Specific data (Art. 4)'), t('Data biometrik dan data anak termasuk data pribadi spesifik.', "Biometric and children's data are specific personal data."), t('Data wajah disimpan 7 hari (1 hari untuk anak); prototipe ini tidak menyimpannya.', 'Face data kept 7 days (1 day for minors); this prototype stores none.')],
    [t('Hak subjek data', 'Data subject rights'), t('Akses, salinan, penghapusan, penarikan persetujuan.', 'Access, a copy, erasure, withdrawing consent.'), t('Unduh data, hapus data (skor tetap dengan nama samaran), cabut izin kapan saja; semua tercatat.', 'Download data, erase data (scores kept under a pseudonym), revoke consent any time; all recorded.')],
    [t('Minimisasi & masa simpan', 'Minimisation & retention'), t('Data disimpan sesuai tujuan dan dihapus setelahnya.', 'Kept for the purpose, then deleted.'), t('Teks esai dan feedback dihapus otomatis setelah masa simpan; skor band tetap.', 'Essay text and feedback are deleted automatically after the retention period; band scores stay.')],
    [t('Keamanan & insiden (Pasal 46)', 'Security & incidents (Art. 46)'), t('Pengendali wajib memberi tahu kegagalan pelindungan data dalam 3×24 jam.', 'Controllers must notify a data-protection failure within 3×24 hours.'), t('Akses per institusi di database, catatan audit yang tidak bisa diubah, pembatasan percobaan login; isi esai tidak disimpan di log AI.', 'Per-institution access in the database, an audit log that cannot be changed, login attempt limits; essay text is never kept in the AI log.')],
  ]
  const PROC = [
    ['Supabase', 'Postgres, Auth', 'Singapore (ap-southeast-1)', t('semua data', 'all data')],
    ['Vercel', t('Server aplikasi', 'App servers'), 'Singapore (sin1)', t('memproses, tidak menyimpan', 'processes, does not store')],
    ['Google Gemini', 'LLM', t('lintas negara', 'cross-border'), t('teks esai hanya dengan izin; tanpa nama/ID; laporan hanya angka agregat', 'essay text only with consent; no names/IDs; reports get aggregates only')],
  ]
  const KIND: Record<string, [string, string, string]> = {
    essay_text: [t('Teks esai', 'Essay text'), t('Kontrak dengan institusi', 'Contract with the institution'), t('Teks dihapus, skor band tetap disimpan', 'Text deleted, band scores kept')],
    ai_feedback: [t('Feedback AI', 'AI feedback'), t('Izin learner atau wali', 'Learner or guardian consent'), t('Feedback dihapus', 'Feedback deleted')],
    audio: [t('Rekaman suara', 'Voice recordings'), t('Izin, hanya untuk latihan speaking', 'Consent, speaking practice only'), t('Dihapus setelah dinilai (prototipe ini tidak menyimpan audio)', 'Deleted after scoring (this prototype stores no audio)')],
    face_embedding: [t('Data wajah', 'Face data'), t('Izin, untuk verifikasi saat tes', 'Consent, for identity checks during tests'), t('Dihapus setelah tes (prototipe ini tidak menyimpannya)', 'Deleted after the test (this prototype stores none)')],
    scores: [t('Skor band', 'Band scores'), t('Kepentingan sah: progres dan koreksi', 'Legitimate interest: progress and correction'), t('Nama diganti pseudonim', 'Name replaced with a pseudonym')],
  }
  const days = (x: number) => t(`${num(x)} hari`, x === 1 ? '1 day' : `${num(x)} days`)
  const lastRun = d.runs[0]
  const lastRows = lastRun ? d.runs.filter(r => r.ran_at === lastRun.ran_at).reduce((a, r) => a + r.rows, 0) : 0
  const consent = (
    <Card title={t('Belum izin AI feedback', 'No AI feedback consent yet')} sub={d.dsr.length ? t('Esai mereka tetap dinilai, tapi feedback dibuat tanpa AI.', 'Their essays are still scored, but feedback is made without AI.')
      : t('Esai mereka tetap dinilai, tapi feedback dibuat tanpa AI. Permintaan ekspor atau hapus data dibuka dari halaman learner.', 'Their essays are still scored, but feedback is made without AI. Export or erasure requests are opened from a learner page.')}>
      <ul className="divided">{d.blocked.slice(0, 6).map(b => <li key={b.id} className="row between"><Link href={`/learners/${b.id}`}>{b.display_name}</Link>
        <span className="muted small">{b.is_minor ? t('perlu izin wali', 'needs guardian consent') : t('perlu izin learner', 'needs learner consent')}</span></li>)}</ul>
    </Card>
  )
  return (
    <>
      <PageHead title={t('Privasi & data', 'Privacy & data')} sub={t('Aturan data pribadi yang dijalankan otomatis oleh sistem, bukan sekadar kebijakan tertulis.', 'Personal-data rules the system runs by itself, not just a written policy.')} />
      <div className="kpis">
        <Kpi label={t('Learner di bawah 18', 'Learners under 18')} value={num(d.c.minors)}
          sub={d.c.minors ? t(`${pct(d.c.minors_consent / d.c.minors)} sudah ada izin wali`, `${pct(d.c.minors_consent / d.c.minors)} have guardian consent`) : t('tidak ada di sini', 'none here')} />
        <Kpi label={t('Belum izin AI feedback', 'No AI feedback consent')} term="consent" value={num(d.c.no_consent)} sub={t('esainya tidak dikirim ke AI', 'their essays never go to AI')} />
        <Kpi label={t('Permintaan data terbuka', 'Open data requests')} value={num(d.dsr.filter(x => x.status === 'open').length)} sub={t('ekspor atau penghapusan', 'export or erasure')} />
        <Kpi label={t('Penghapusan otomatis', 'Automatic deletion')} term="retention" value={lastRun ? date(lastRun.ran_at) : t('Belum', 'Not yet')}
          sub={lastRun ? t(`${num(lastRows)} data dihapus`, `${num(lastRows)} records deleted`) : t('berjalan tiap hari 02:15 WIB', 'runs daily at 02:15 WIB')} />
      </div>

      <Card title={t('Berapa lama data disimpan', 'How long data is kept')} sub={t('Lebih singkat untuk learner di bawah 18 tahun. Dihapus otomatis tiap hari pukul 02:15 WIB.', 'Shorter for learners under 18. Deleted automatically every day at 02:15 WIB.')}
        right={me.role === 'platform' ? <ActionButton small url="/api/privacy/purge">{t('Hapus sekarang', 'Delete now')}</ActionButton> : undefined} pad={false}>
        <div className="table-wrap"><table className="data">
          <thead><tr><th>{t('Data', 'Data')}</th><th>{t('Alasan disimpan', 'Why it is kept')}</th><th className="num">{t('Dewasa', 'Adults')}</th><th className="num">{t('Di bawah 18', 'Under 18')}</th><th>{t('Setelah itu', 'After that')}</th></tr></thead>
          <tbody>{d.policies.map(p => {
            const k = KIND[p.data_kind] ?? [p.data_kind, p.basis, p.action]
            return <tr key={p.data_kind}><td className="strong">{k[0]}</td><td className="muted">{k[1]}</td><td className="num">{days(p.keep_days)}</td><td className="num">{days(p.keep_days_minor)}</td><td>{k[2]}</td></tr>
          })}</tbody>
        </table></div>
      </Card>

      {d.dsr.length > 0 ? (
        <div className="cols-even">
          <Card title={t('Permintaan ekspor dan penghapusan', 'Export and erasure requests')} sub={t('Dibuka dari halaman learner, diselesaikan di sini.', 'Opened from a learner page, completed here.')}>
            <ul className="divided">
              {d.dsr.slice(0, 6).map(r => (
                <li key={r.id} className="row between">
                  <span className="row" style={{ gap: 8 }}><Badge tone={r.kind === 'erase' ? 'bad' : 'brand'}>{r.kind === 'erase' ? t('Hapus', 'Erase') : t('Ekspor', 'Export')}</Badge><Link href={`/learners/${r.student_id}`}>{r.display_name}</Link></span>
                  {r.status === 'open'
                    ? <ActionButton small url={`/api/privacy/dsr/${r.id}`} confirmText={r.kind === 'erase' ? t('Hapus permanen?', 'Erase for good?') : undefined} download={r.kind === 'export' ? `altimeter-export-${r.id}.json` : undefined}>{r.kind === 'erase' ? t('Hapus data', 'Erase data') : t('Unduh data', 'Download data')}</ActionButton>
                    : <span className="muted small">{t(`Selesai ${date(r.completed_at)}`, `Done ${date(r.completed_at)}`)}</span>}
                </li>
              ))}
            </ul>
          </Card>
          {consent}
        </div>
      ) : consent}

      <Card title={t('Sesuai UU PDP No. 27/2022', "Indonesia's PDP Law (No. 27/2022)")} sub={t('Ringkasan untuk didiskusikan dengan penasihat hukum, bukan nasihat hukum.', 'A summary to discuss with counsel, not legal advice.')} pad={false}>
        <div className="table-wrap"><table className="data">
          <thead><tr><th>{t('Ketentuan', 'Provision')}</th><th>{t('Intinya', 'In short')}</th><th>{t('Di Altimeter', 'In Altimeter')}</th></tr></thead>
          <tbody>{PDP.map(r => <tr key={r[0]}><td className="strong nowrap">{r[0]}</td><td>{r[1]}</td><td>{r[2]}</td></tr>)}</tbody>
        </table></div>
      </Card>

      <Card title={t('Siapa yang memproses data', 'Who processes the data')} pad={false}>
        <div className="table-wrap"><table className="data">
          <thead><tr><th>{t('Layanan', 'Service')}</th><th>{t('Untuk', 'For')}</th><th>{t('Lokasi', 'Location')}</th><th>{t('Data yang dilihat', 'Data it sees')}</th></tr></thead>
          <tbody>{PROC.map(p => <tr key={p[0]}><td className="strong">{p[0]}</td><td>{p[1]}</td><td>{p[2]}</td><td className="muted">{p[3]}</td></tr>)}</tbody>
        </table></div>
      </Card>
    </>
  )
}
