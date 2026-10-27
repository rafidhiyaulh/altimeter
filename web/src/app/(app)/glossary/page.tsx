import { requireMe } from '@/lib/auth'
import { getT, titled } from '@/lib/i18n-server'
import { Card, PageHead } from '@/components/ui'
import { GLOSSARY } from '@/lib/glossary'

export const generateMetadata = titled('Glosarium', 'Glossary')

const GROUPS: { title: [string, string]; keys: (keyof typeof GLOSSARY)[] }[] = [
  { title: ['Kesiapan', 'Readiness'], keys: ['readiness', 'p_target', 'binding', 'pace', 'priority', 'capacity', 'interval'] },
  { title: ['Kepercayaan skor', 'Score trust'], keys: ['audit', 'within_half', 'bias', 'qwk', 'calibration', 'brier', 'drivers', 'flags', 'grounded'] },
  { title: ['Privasi', 'Privacy'], keys: ['consent', 'retention', 'ledger'] },
  { title: ['Teknis', 'Under the hood'], keys: ['kalman', 'bitemporal', 'rls', 'dlq'] },
]

const NAMES: Record<string, [string, string]> = {
  readiness: ['Kesiapan', 'Readiness'], p_target: ['Peluang lulus', 'Chance to pass'], binding: ['Skill paling lemah', 'Weakest skill'],
  pace: ['Perlu naik per minggu', 'Needed gain per week'], priority: ['Urutan bantuan', 'Who to help first'], capacity: ['Slot coaching', 'Coaching slots'],
  kalman: ['Pelacak level (Kalman)', 'Level tracker (Kalman)'], interval: ['Rentang kemungkinan', 'Likely range'], calibration: ['Koreksi', 'Correction'], audit: ['Cek acak', 'Random check'],
  qwk: ['Skor kesepakatan (QWK)', 'Agreement score (QWK)'], within_half: ['AI dekat dengan guru', 'AI close to teachers'], bias: ['AI terlalu tinggi/rendah', 'AI too high or low'], drivers: ['Mengapa band ini', 'Why this band'],
  flags: ['Perlu dicek manusia', 'Needs a human look'], grounded: ['Kutipan dicek', 'Checked quotes'], consent: ['Izin AI feedback', 'AI feedback consent'],
  retention: ['Penghapusan otomatis', 'Automatic deletion'], ledger: ['Catatan permanen', 'Permanent record'], bitemporal: ['Riwayat versi skor', 'Score version history'],
  rls: ['Akses per institusi (RLS)', 'Per-school access (RLS)'], dlq: ['Job gagal (DLQ)', 'Failed jobs (DLQ)'], brier: ['Ketepatan peluang (Brier)', 'How good the chances are (Brier)'],
}

export default async function Glossary() {
  await requireMe()
  const { t } = await getT()
  return (
    <>
      <PageHead title={t('Glosarium', 'Glossary')} sub={t('Arti setiap istilah di Altimeter, dalam bahasa sehari-hari.', 'What every term in Altimeter means, in everyday words.')} />
      {GROUPS.map(g => (
        <Card key={g.title[1]} title={t(...g.title)} pad={false}>
          <dl className="gloss">{g.keys.map(k => (
            <div key={k}><dt>{t(...NAMES[k])}</dt><dd>{t(GLOSSARY[k][0], GLOSSARY[k][1])}</dd></div>
          ))}</dl>
        </Card>
      ))}
    </>
  )
}
