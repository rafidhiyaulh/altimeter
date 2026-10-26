import Link from 'next/link'
import { requireMe } from '@/lib/auth'
import { asUser } from '@/lib/db'
import { getT, titled } from '@/lib/i18n-server'
import { date, dateTime, num, pct } from '@/lib/format'
import { Badge, Card, Kpi, PageHead } from '@/components/ui'
import { ActionButton } from '@/components/Action'
import { Baby, BotOff, FileClock, Trash2 } from 'lucide-react'

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
    [t('Data anak (Pasal 25)', "Children's data (Art. 25)"), t('Pemrosesan data anak memerlukan persetujuan orang tua/wali.', "Processing a child's data needs parent/guardian consent."), t('Izin wali per tujuan; tanpa izin, esai tidak pernah dikirim ke LLM.', 'Guardian consent per purpose; without it the essay is never sent to an LLM.')],
    [t('Data spesifik (Pasal 4)', 'Specific data (Art. 4)'), t('Data biometrik dan data anak termasuk data pribadi spesifik.', "Biometric and children's data are specific personal data."), t('Embedding wajah: masa simpan 7 hari (1 hari untuk anak); prototipe ini tidak menyimpannya.', 'Face embeddings: 7-day retention (1 day for minors); this prototype stores none.')],
    [t('Hak subjek data', 'Data subject rights'), t('Akses, salinan, penghapusan, penarikan persetujuan.', 'Access, a copy, erasure, withdrawing consent.'), t('Ekspor JSON, penghapusan dengan pseudonim, cabut izin kapan saja; semua tercatat di audit log.', 'JSON export, erasure with a pseudonym, revoke consent any time; all in the audit log.')],
    [t('Minimisasi & masa simpan', 'Minimisation & retention'), t('Data disimpan sesuai tujuan dan dihapus setelahnya.', 'Kept for the purpose, then deleted.'), t('pg_cron menghapus teks esai & feedback setelah masa simpan; skor band tetap.', 'pg_cron deletes essay text & feedback after retention; band scores stay.')],
    [t('Keamanan & insiden (Pasal 46)', 'Security & incidents (Art. 46)'), t('Pengendali wajib memberi tahu kegagalan pelindungan data dalam 3×24 jam.', 'Controllers must notify a data-protection failure within 3×24 hours.'), t('RLS, audit log berantai, rate limit, CSP/HSTS; log LLM hanya hash prompt, bukan isinya.', 'RLS, chained audit log, rate limits, CSP/HSTS; the LLM log stores a prompt hash, never its content.')],
  ]
  const PROC = [
    ['Supabase', 'Postgres, Auth', 'Singapore (ap-southeast-1)', t('semua data', 'all data')],
    ['Vercel', t('Server aplikasi', 'App servers'), 'Singapore (sin1)', t('memproses, tidak menyimpan', 'processes, does not store')],
    ['Google Gemini', 'LLM', t('lintas negara', 'cross-border'), t('teks esai hanya dengan izin; tanpa nama/ID; laporan hanya angka agregat', 'essay text only with consent; no names/IDs; reports get aggregates only')],
  ]
  return (
    <>
      <PageHead title={t('Privasi & data', 'Privacy & data')} sub={t('Aturan data yang ditegakkan sistem.', 'Data rules the system enforces.')} />
      <div className="kpis">
        <Kpi icon={Baby} label={t('Learner di bawah 18', 'Learners under 18')} value={num(d.c.minors)} sub={`${pct(d.c.minors ? d.c.minors_consent / d.c.minors : null)} ${t('dengan izin wali', 'with guardian consent')}`} />
        <Kpi icon={BotOff} label={t('AI feedback diblokir', 'AI feedback blocked')} term="consent" value={num(d.c.no_consent)} sub={t('tanpa izin, esai tidak ke LLM', 'no consent, no essay to the LLM')} />
        <Kpi icon={FileClock} label={t('Permintaan data terbuka', 'Open data requests')} value={num(d.dsr.filter(x => x.status === 'open').length)} />
        <Kpi icon={Trash2} label={t('Purge terakhir', 'Last purge')} term="retention" value={d.runs[0] ? date(d.runs[0].ran_at) : '-'} sub={d.runs[0] ? `${d.runs[0].trigger}` : t('belum pernah', 'never')} />
      </div>
      <div className="cols-even">
        <Card title={t('Masa simpan', 'Retention')} right={me.role === 'platform' ? <ActionButton small url="/api/privacy/purge">{t('Jalankan purge sekarang', 'Run purge now')}</ActionButton> : undefined}
          sub={t('Otomatis tiap hari 02:15 WIB.', 'Daily at 02:15 WIB.')}>
          <table className="data">
            <thead><tr><th>{t('Jenis data', 'Data')}</th><th className="num">{t('Dewasa', 'Adults')}</th><th className="num">{t('Anak', 'Minors')}</th><th>{t('Setelahnya', 'Then')}</th></tr></thead>
            <tbody>{d.policies.map(p => <tr key={p.data_kind}><td>{p.data_kind.replace(/_/g, ' ')}<div className="muted small">{p.basis}</div></td><td className="num">{num(p.keep_days)} {t('hari', 'd')}</td><td className="num">{num(p.keep_days_minor)} {t('hari', 'd')}</td><td className="small">{p.action}</td></tr>)}</tbody>
          </table>
          {d.runs.length > 0 && <p className="muted small" style={{ marginTop: 8 }}>{d.runs.slice(0, 2).map(r => `${dateTime(r.ran_at)}: ${r.data_kind} ${r.rows}`).join(' · ')}</p>}
        </Card>
        <Card title={t('Permintaan subjek data', 'Data subject requests')} sub={t('Dibuka dari halaman learner.', 'Opened from a learner page.')}>
          <ul className="divided">
            {d.dsr.map(r => (
              <li key={r.id} className="row between">
                <span>#{r.id} <Badge tone={r.kind === 'erase' ? 'bad' : 'brand'}>{r.kind === 'erase' ? t('hapus', 'erase') : t('ekspor', 'export')}</Badge> <Link href={`/learners/${r.student_id}`}>{r.display_name}</Link> <span className="muted small">{date(r.created_at)}</span></span>
                {r.status === 'open'
                  ? <ActionButton small url={`/api/privacy/dsr/${r.id}`} confirmText={r.kind === 'erase' ? t('Hapus permanen?', 'Erase for good?') : undefined} download={r.kind === 'export' ? `altimeter-export-${r.id}.json` : undefined}>{t('Selesaikan', 'Complete')}</ActionButton>
                  : <span className="muted small">{t('selesai', 'done')} {date(r.completed_at)}</span>}
              </li>
            ))}
            {d.dsr.length === 0 && <li className="muted">{t('Belum ada permintaan.', 'No requests yet.')}</li>}
          </ul>
        </Card>
      </div>
      <div className="cols-even" style={{ marginTop: 16 }}>
        <Card title={t('Pemetaan UU PDP No. 27/2022', 'Mapping to Indonesia\'s PDP Law (No. 27/2022)')} sub={t('Bukan nasihat hukum.', 'Not legal advice.')} pad={false}>
          <div className="table-wrap"><table className="data">
            <thead><tr><th>{t('Ketentuan', 'Provision')}</th><th>{t('Intinya', 'In short')}</th><th>{t('Di Altimeter', 'In Altimeter')}</th></tr></thead>
            <tbody>{PDP.map(r => <tr key={r[0]}><td className="strong" style={{ whiteSpace: 'nowrap' }}>{r[0]}</td><td className="small">{r[1]}</td><td className="small">{r[2]}</td></tr>)}</tbody>
          </table></div>
        </Card>
        <div className="stack-16">
          <Card title={t('Pemroses data', 'Processors')} pad={false}>
            <div className="table-wrap"><table className="data"><tbody>{PROC.map(p => <tr key={p[0]}><td className="strong">{p[0]}</td><td>{p[1]}</td><td className="small">{p[2]}</td><td className="small muted">{p[3]}</td></tr>)}</tbody></table></div>
          </Card>
          <Card title={t('AI feedback diblokir untuk', 'AI feedback blocked for')}>
            <ul className="divided">{d.blocked.map(b => <li key={b.id} className="row between"><Link href={`/learners/${b.id}`}>{b.display_name}</Link>{b.is_minor ? <Badge tone="low">{t('di bawah 18, perlu izin wali', 'under 18, needs guardian consent')}</Badge> : <Badge tone="neutral">{t('perlu izin learner', 'needs learner consent')}</Badge>}</li>)}</ul>
          </Card>
        </div>
      </div>
    </>
  )
}
