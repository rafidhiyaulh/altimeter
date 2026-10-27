import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireMe } from '@/lib/auth'
import { asUser } from '@/lib/db'
import { getT } from '@/lib/i18n-server'
import { UUID } from '@/lib/guard'
import { band, date, dateTime, num, signed } from '@/lib/format'
import { featureLabel, flagLabel } from '@/lib/labels'
import { Badge, Card, CRIT_LABEL, CRIT_SHORT, Facts, Meta, PageHead } from '@/components/ui'
import { ArrowLeft, ChevronRight } from 'lucide-react'
import { Term } from '@/components/Help'
import { FeedbackPanel, ReviewForm, StatusPoller, type Fb } from '@/components/EssayClient'

export const metadata = { title: 'Essay' }

function highlight(text: string, quotes: string[]) {
  // mark the first occurrence of every grounded quote (case and spacing relaxed)
  const spans: [number, number][] = []
  const lower = text.toLowerCase()
  for (const q of quotes) {
    const re = new RegExp(q.toLowerCase().trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'))
    const m = re.exec(lower)
    if (m) spans.push([m.index, m.index + m[0].length])
  }
  spans.sort((a, b) => a[0] - b[0])
  const out: React.ReactNode[] = []
  let at = 0
  spans.forEach(([a, b], i) => {
    if (a < at) return
    out.push(text.slice(at, a), <mark key={i}>{text.slice(a, b)}</mark>)
    at = b
  })
  out.push(text.slice(at))
  return out
}

export default async function EssayPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireMe()
  const { t, lang } = await getT()
  const id = (await params).id
  if (!UUID.test(id)) notFound()
  const d = await asUser(me, async tx => {
    const [e] = await tx`
      select e.*, p.body as prompt, p.question_type, s.display_name, s.id as student_id, c.name as cohort, alt.ai_allowed(e.id) as ai
      from alt.essays e join alt.prompts p on p.id = e.prompt_id join alt.students s on s.id = e.student_id join alt.cohorts c on c.id = s.cohort_id
      where e.id = ${id}`
    if (!e) return null
    const versions = await tx`select * from alt.essay_scores where essay_id = ${id} order by valid_from desc`
    const [fb] = await tx`select content, source, lang, dropped from alt.essay_feedback where essay_id = ${id} and lang = ${lang} order by created_at desc limit 1`
    const reviews = await tx`select r.seq, r.tr, r.cc, r.lr, r.gra, r.overall, r.ai_overall, r.reason, r.note, r.created_at, r.hash, p.display_name as reviewer
      from alt.reviews r left join alt.profiles p on p.user_id = r.reviewer where r.essay_id = ${id} order by r.seq desc`
    const [q] = await tx`select reason, done_at from alt.review_queue where essay_id = ${id}`
    return { e, versions, fb, reviews, q }
  })
  if (!d) notFound()
  const { e, versions, fb, reviews, q } = d
  const cur = versions.find(v => v.valid_to == null)
  const staff = me.role !== 'student'
  const quotes = (fb?.content?.items ?? []).map((i: { quote: string | null }) => i.quote).filter(Boolean) as string[]
  // While a teacher still has to mark this essay blind, the AI score stays hidden.
  const blind = staff && e.status === 'scored' && q != null && !q.done_at
  const drivers = (cur?.drivers ?? []) as { c: string; f: string; v: number; d: number }[]

  return (
    <>
      <Link href={me.role === 'student' ? '/me' : `/learners/${e.student_id}`} className="back"><ArrowLeft size={15} aria-hidden />{me.role === 'student' ? t('Kesiapan saya', 'My readiness') : e.display_name}</Link>
      <PageHead title={t('Esai Writing Task 2', 'Writing Task 2 essay')} meta={<Meta items={[e.display_name, e.cohort, dateTime(e.submitted_at), t(`${num(e.word_count)} kata`, `${num(e.word_count)} words`)]} />} />
      {e.status === 'queued' && <StatusPoller id={id} />}
      <div className="cols-2">
        <div className="stack-16">
          <Card title={t('Soal', 'Prompt')}><p className="prompt-box">{e.prompt}</p></Card>
          <Card title={t('Esai', 'Essay')} sub={quotes.length && !blind ? t('Kutipan feedback ditandai.', 'Quoted parts highlighted.') : undefined}>
            {e.body ? <div className="essay-text">{highlight(e.body, blind ? [] : quotes)}</div>
              : <p className="note">{t(`Teks dihapus ${date(e.purged_at)} sesuai kebijakan masa simpan. Skor tetap ada.`, `Text deleted ${date(e.purged_at)} under the retention policy. The scores remain.`)}</p>}
          </Card>
        </div>
        <div className="stack-16">
          {cur && !blind && (
            <Card title={t('Skor model writing', 'Writing model score')} sub={<><Term k="interval">{t('Kemungkinan antara', 'Likely between')}</Term> {band(cur.lo80)} {t('dan', 'and')} {band(cur.hi80)}</>}>
              <div className="row" style={{ alignItems: 'baseline', gap: 10, marginBottom: 12 }}>
                <span className="big-p">{band(cur.overall)}</span>
                <span className="muted">{t('perkiraan band overall, bukan skor resmi', 'estimated overall band, not an official score')}</span>
              </div>
              <div className="crit">
                {(['tr', 'cc', 'lr', 'gra'] as const).map(k => (
                  <div key={k}><div className="k" title={CRIT_LABEL(k.toUpperCase())}>{CRIT_SHORT(k)}</div><div className="v">{band(cur[k])}</div></div>
                ))}
              </div>
              {cur.flags?.length > 0 && (
                <div className="row" style={{ marginTop: 12, gap: 6 }}>
                  <Term k="flags">{t('Perlu dicek manusia:', 'Needs a human look:')}</Term>
                  {cur.flags.map((f: string) => <Badge key={f} tone="warn">{flagLabel(f)}</Badge>)}
                </div>
              )}
              <details className="tech">
                <summary><ChevronRight size={14} aria-hidden /><Term k="drivers">{t('Mengapa band ini', 'Why this band')}</Term></summary>
                <table className="data" style={{ marginTop: 8 }}>
                  <thead><tr><th>{t('Kriteria', 'Criterion')}</th><th>{t('Ciri esai', 'Essay feature')}</th><th className="num">{t('Nilai', 'Value')}</th><th className="num">{t('Efek', 'Effect')}</th></tr></thead>
                  <tbody>{drivers.map((x, i) => (
                    <tr key={i}><td>{x.c}</td><td>{featureLabel(x.f)}</td><td className="num">{num(Math.round(x.v * 100) / 100)}</td>
                      <td className={`num ${x.d < 0 ? 'bad' : 'ok'}`}>{signed(x.d, 2)}</td></tr>))}</tbody>
                </table>
              </details>
            </Card>
          )}
          {e.status === 'scored' && e.body && !blind && (
            <Card title={t('Feedback', 'Feedback')} sub={<Term k="grounded">{t('Setiap kutipan dicek ada di esai', 'Every quote is checked against the essay')}</Term>}>
              <FeedbackPanel id={id} aiAllowed={Boolean(e.ai)} initial={fb ? { fb: fb.content as Fb, source: fb.source, lang: fb.lang, dropped: fb.dropped } : null} />
            </Card>
          )}
          {staff && e.status === 'scored' && (
            <Card title={t('Nilai sebagai guru', 'Mark as a teacher')} sub={q ? <><Term k="audit">{q.reason === 'random_audit' ? t('Terpilih audit acak', 'Picked for the random audit') : q.reason === 'low_confidence' ? t('Skor AI kurang yakin', 'Low-confidence AI score') : t('Banding', 'Appeal')}</Term>{q.done_at ? `. ${t('Sudah dinilai.', 'Already marked.')}` : ''}</> : undefined}>
              <ReviewForm id={id} blind={blind} />
            </Card>
          )}
          {!blind && (reviews.length > 0 || versions.length > 1) && (
            <Card title={t('Riwayat', 'History')} sub={<Term k="ledger">{t('Catatan permanen, tidak bisa diubah', 'A permanent record that cannot be changed')}</Term>}>
              <ul className="divided">
                {reviews.map(r => (
                  <li key={`r${r.seq}`}>
                    <div className="row between"><b>{t('Guru', 'Teacher')} {band(r.overall)}</b><span className="muted small">{dateTime(r.created_at)}</span></div>
                    <Facts tight items={[{ label: CRIT_SHORT('tr'), value: band(r.tr) }, { label: CRIT_SHORT('cc'), value: band(r.cc) }, { label: CRIT_SHORT('lr'), value: band(r.lr) }, { label: CRIT_SHORT('gra'), value: band(r.gra) },
                      { label: t('AI saat itu', 'AI then'), value: band(r.ai_overall) }, { label: t('Oleh', 'By'), value: r.reviewer ?? '-' }]} />
                    {r.note && <p className="small" style={{ marginTop: 4 }}>{r.note}</p>}
                  </li>
                ))}
                {versions.map(v => (
                  <li key={`v${v.id}`} className="row between">
                    <span>{t('Skor AI', 'AI score')} <b>{band(v.overall)}</b></span>
                    <span className="muted small">{v.valid_to ? t(`${dateTime(v.valid_from)} sampai ${dateTime(v.valid_to)}`, `${dateTime(v.valid_from)} to ${dateTime(v.valid_to)}`) : t(`berlaku sejak ${dateTime(v.valid_from)}`, `current since ${dateTime(v.valid_from)}`)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </>
  )
}
