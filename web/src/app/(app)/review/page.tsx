import Link from 'next/link'
import { requireMe } from '@/lib/auth'
import { asUser } from '@/lib/db'
import { getT, titled } from '@/lib/i18n-server'
import { band, date, num } from '@/lib/format'
import { flagLabel } from '@/lib/labels'
import { Badge, Card, PageHead, Seg } from '@/components/ui'
import { Term } from '@/components/Help'
import { LinkPager } from '@/components/Pager'

export const generateMetadata = titled('Review esai', 'Essay review')

export default async function ReviewQueue({ searchParams }: { searchParams: Promise<{ r?: string; page?: string }> }) {
  const me = await requireMe(['platform', 'inst_admin', 'teacher'])
  const { t } = await getT()
  const sp = await searchParams
  const reason = sp.r === 'low_confidence' || sp.r === 'done' ? sp.r : 'random_audit'
  const rows = await asUser(me, tx => tx`
    select q.essay_id, q.reason, q.queued_at, q.done_at, e.submitted_at, e.word_count, s.display_name, c.name as cohort, v.flags,
           (select r.overall from alt.reviews r where r.essay_id = q.essay_id order by r.seq desc limit 1) as teacher, v.overall
    from alt.review_queue q join alt.essays e on e.id = q.essay_id join alt.students s on s.id = e.student_id
    join alt.cohorts c on c.id = s.cohort_id left join alt.v_essay_current v on v.id = q.essay_id
    where ${reason === 'done' ? tx`q.done_at is not null` : tx`q.done_at is null and q.reason = ${reason}`} and e.body is not null
    order by ${reason === 'done' ? tx`q.done_at desc` : tx`e.submitted_at`}`)
  const [counts] = await asUser(me, tx => tx`select count(*) filter (where done_at is null and reason = 'random_audit')::int as a,
    count(*) filter (where done_at is null and reason = 'low_confidence')::int as l, count(*) filter (where done_at is not null)::int as d from alt.review_queue`)
  const per = 15
  const page = Math.max(1, Math.min(Math.ceil(rows.length / per) || 1, Number(sp.page) || 1))
  return (
    <>
      <PageHead title={t('Review esai', 'Essay review')} sub={t('Nilai ulang esai tanpa melihat skor AI.', 'Re-mark essays without seeing the AI score.')} />
      <Card pad={false} right={<Seg active={reason} items={[
        { key: 'random_audit', label: t('Cek acak', 'Random check'), href: '/review?r=random_audit', count: counts.a },
        { key: 'low_confidence', label: t('AI ragu', 'AI unsure'), href: '/review?r=low_confidence', count: counts.l },
        { key: 'done', label: t('Sudah dinilai', 'Done'), href: '/review?r=done', count: counts.d },
      ]} />} title={reason === 'random_audit' ? <Term k="audit">{t('Cek acak', 'Random check')}</Term> : reason === 'low_confidence' ? t('Skor yang AI-nya ragu', 'Scores the AI is unsure about') : t('Sudah dinilai guru', 'Already marked by a teacher')}
        sub={reason === 'random_audit' ? t('1 dari 10 esai dipilih acak, supaya kita tahu seberapa akurat AI.', '1 in 10 essays is picked at random, so we know how accurate the AI is.') : reason === 'low_confidence' ? t('Esai terlalu pendek, keluar topik, atau penuh template.', 'Essays that are too short, off topic or full of templates.') : undefined}>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>{t('Dikirim', 'Submitted')}</th><th>{t('Learner', 'Learner')}</th><th>{t('Kohort', 'Cohort')}</th><th className="num">{t('Kata', 'Words')}</th><th>{t('Catatan', 'Notes')}</th>
              {reason === 'done' && <><th className="num">AI</th><th className="num">{t('Guru', 'Teacher')}</th></>}<th /></tr></thead>
            <tbody>
              {rows.slice((page - 1) * per, page * per).map(r => (
                <tr key={r.essay_id}>
                  <td>{date(r.submitted_at)}</td><td>{r.display_name}</td><td className="muted">{r.cohort}</td><td className="num">{num(r.word_count)}</td>
                  <td>{(r.flags ?? []).map((f: string) => <Badge key={f} tone="warn">{flagLabel(f)}</Badge>)}</td>
                  {reason === 'done' && <><td className="num">{band(r.overall)}</td><td className="num">{band(r.teacher)}</td></>}
                  <td><Link className="btn btn-sm" href={`/essays/${r.essay_id}`}>{reason === 'done' ? t('Lihat', 'Open') : t('Nilai', 'Mark')}</Link></td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={7} className="muted">{t('Antrean kosong.', 'The queue is empty.')}</td></tr>}
            </tbody>
          </table>
        </div>
        <LinkPager page={page} total={rows.length} size={per} href={p => `/review?r=${reason}&page=${p}`} />
      </Card>
    </>
  )
}
