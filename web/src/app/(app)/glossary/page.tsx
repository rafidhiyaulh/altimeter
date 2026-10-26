import { requireMe } from '@/lib/auth'
import { getT, titled } from '@/lib/i18n-server'
import { Card, PageHead } from '@/components/ui'
import { GLOSSARY } from '@/components/Help'

export const generateMetadata = titled('Glosarium', 'Glossary')

const NAMES: Record<string, [string, string]> = {
  readiness: ['Kesiapan', 'Readiness'], p_target: ['Peluang mencapai target', 'Chance of reaching the target'], binding: ['Skill penentu', 'Binding skill'],
  pace: ['Laju vs kebutuhan', 'Pace vs needed'], priority: ['Prioritas intervensi', 'Intervention priority'], capacity: ['Kapasitas coaching', 'Coaching capacity'],
  kalman: ['Filter Kalman', 'Kalman filter'], interval: ['Rentang 80%', '80% range'], calibration: ['Kalibrasi', 'Calibration'], audit: ['Audit acak', 'Random audit'],
  qwk: ['QWK', 'QWK'], within_half: ['Dalam ±0,5 band', 'Within ±0.5 band'], bias: ['Bias', 'Bias'], drivers: ['Pendorong skor', 'Score drivers'],
  flags: ['Tanda cek manusia', 'Human-check flags'], grounded: ['Grounding', 'Grounding'], consent: ['Izin AI feedback', 'AI-feedback consent'],
  retention: ['Masa simpan', 'Retention'], ledger: ['Ledger', 'Ledger'], bitemporal: ['Bitemporal', 'Bitemporal'], rls: ['RLS', 'RLS'], dlq: ['DLQ', 'DLQ'], brier: ['Brier score', 'Brier score'],
}

export default async function Glossary() {
  await requireMe()
  const { t } = await getT()
  return (
    <>
      <PageHead title={t('Glosarium', 'Glossary')} sub={t('Istilah dalam bahasa sederhana.', 'Terms in plain language.')} />
      <Card pad={false}>
        <div className="table-wrap"><table className="data">
          <tbody>{Object.entries(GLOSSARY).map(([k, v]) => (
            <tr key={k}><td className="strong" style={{ whiteSpace: 'nowrap', verticalAlign: 'top' }}>{t(...(NAMES[k] ?? [k, k]))}</td><td>{t(v[0], v[1])}</td></tr>
          ))}</tbody>
        </table></div>
      </Card>
    </>
  )
}
