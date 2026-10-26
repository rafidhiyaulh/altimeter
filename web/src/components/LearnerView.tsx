import Link from 'next/link'
import type { Me } from '@/lib/auth'
import { n } from '@/lib/db'
import { getT } from '@/lib/i18n-server'
import { learnerDetail, trajectories } from '@/lib/learner'
import { ago, band, date, dec, num, pct, requestNow } from '@/lib/format'
import { Badge, Card, Empty, Facts, Meta, PageHead, ReadyBadge, SKILL_LABEL, Status } from './ui'
import { ArrowLeft } from 'lucide-react'
import { Trajectory, TrajectoryLegend } from './charts'
import { Term } from './Help'
import { PrivacyActions } from './PrivacyActions'

export async function LearnerView({ me, id, self }: { me: Me; id: number; self?: boolean }) {
  const { t } = await getT()
  const d = await learnerDetail(me, id)
  if (!d) return <Empty>{t('Learner tidak ditemukan atau di luar akses Anda.', 'Learner not found or outside your access.')}</Empty>
  const { l, obs, essays, officials, consents, cal } = d
  const now = requestNow()
  const deadline = new Date(`${l.deadline}T23:59:00+07:00`).getTime()
  const start = Math.min(now - 16 * 7 * 86400000, ...obs.map(o => new Date(o.taken_at).getTime()))
  const traj = trajectories(obs, cal, l.skills, deadline, now)
  const p = n(l.p_target)
  const min = n(l.target_min_skill)!
  const target = n(l.target_overall)!
  const binding = traj.find(x => x.skill === l.binding)?.state ?? null
  const inactive = l.last_activity ? now - new Date(l.last_activity).getTime() > 21 * 86400000 : true
  const staff = me.role !== 'student'

  const needTo = band(Math.max(min, target - 0.5))
  const needWk = binding?.neededPerWeek != null && binding.neededPerWeek > 0 ? binding.neededPerWeek : null
  const weeks = Math.max(1, Math.round((new Date(l.deadline).getTime() - now) / (7 * 86400000)))
  const gain = needWk == null ? '0.0' : Math.max(0.1, needWk * weeks).toFixed(1)
  const slope = binding?.slope ?? 0
  const rising = slope > 0.005
  const sentence = l.status === 'insufficient_data' || p == null
    ? t('Belum cukup data untuk memperkirakan. Satu mock test lengkap (empat skill) sudah cukup untuk memulai.', 'Not enough data to estimate yet. One full mock test (all four skills) is enough to start.')
    : binding
      ? (needWk
        ? t(`${SKILL_LABEL(l.binding)} adalah skill paling lemah: sekitar ${band(binding.level)} sekarang, perlu ${needTo} pada ${date(l.deadline)}. Artinya naik +${gain} band dalam ${weeks} minggu. ${rising ? `Saat ini naik sekitar ${slope.toFixed(2)} per minggu.` : 'Saat ini belum naik.'}`,
            `${SKILL_LABEL(l.binding)} is the weakest skill: about ${band(binding.level)} today, and it needs ${needTo} by ${date(l.deadline)}. That is +${gain} band in ${weeks} weeks. ${rising ? `It is rising about ${slope.toFixed(2)} a week.` : 'Right now it is not rising.'}`)
        : t(`${SKILL_LABEL(l.binding)} paling lemah (${band(binding.level)}), tapi sudah di atas target minimum. Pertahankan.`, `${SKILL_LABEL(l.binding)} is the weakest (${band(binding.level)}) but already above the minimum. Keep it up.`))
      : ''

  const next: string[] = []
  if (l.status === 'insufficient_data') next.push(t('Ikuti satu mock test lengkap.', 'Take one full mock test.'))
  if (inactive) next.push(t('Mulai latihan lagi: sudah 3 minggu tidak ada latihan, jadi perkiraan menganggap tidak ada kenaikan.', 'Start practising again: there has been no practice for 3 weeks, so the estimate assumes no progress.'))
  if (l.binding === 'writing') next.push(t('Tulis satu esai Task 2 per minggu dan baca feedback-nya.', 'Write one Task 2 essay a week and read its feedback.'))
  if (l.binding === 'speaking') next.push(t('Dua sesi latihan speaking per minggu, fokus Part 2.', 'Two speaking sessions a week, focusing on Part 2.'))
  if (l.binding === 'reading' || l.binding === 'listening') next.push(t(`Satu set latihan ${SKILL_LABEL(l.binding)} berwaktu per minggu.`, `One timed ${SKILL_LABEL(l.binding)} set a week.`))

  return (
    <>
      {!self && <Link href={`/cohorts/${l.cohort_id}`} className="back"><ArrowLeft size={15} aria-hidden />{l.cohort}</Link>}
      <PageHead title={self ? t('Kesiapan saya', 'My readiness') : l.display_name}
        meta={<Meta items={[self ? null : l.cohort, self ? l.cohort : l.institution,
          <>{t('Target', 'Target')} <b>{band(target)}</b>, {t('tiap skill minimal', 'each skill at least')} <b>{band(min)}</b></>,
          <>{t('Deadline', 'Deadline')} <b>{date(l.deadline)}</b></>]} />}>
        {self && <Link href="/write" className="btn btn-primary">{t('Tulis esai', 'Write an essay')}</Link>}
      </PageHead>

      <Card>
        <div className="summary">
          <div>
            <div className="muted small"><Term k="p_target">{t('Peluang mencapai target', 'Chance of reaching the target')}</Term></div>
            <div className="big-p">{p == null ? '-' : pct(p)}</div>
            <div style={{ marginTop: 6 }}><ReadyBadge status={l.status} /></div>
          </div>
          <div>
            <p style={{ lineHeight: 1.6, maxWidth: '62ch' }}>{sentence}</p>
            <div style={{ marginTop: 14 }}>
              <Facts tight items={[
                { label: t('Overall sekarang', 'Overall today'), value: band(l.overall_now) },
                { label: t('Perkiraan saat deadline', 'Expected at deadline'), value: band(n(l.overall_at_deadline) != null ? Math.floor(n(l.overall_at_deadline)! * 2 + 0.5) / 2 : null) },
                { label: t('Latihan 2 minggu terakhir', 'Practice, last 2 weeks'), value: t(`${num(l.attempts_14d)} kali`, `${num(l.attempts_14d)} times`) },
                { label: t('Terakhir latihan', 'Last practice'), value: l.last_activity ? ago(l.last_activity) : '-' },
              ]} />
            </div>
          </div>
          <div>
            <div className="subhead">{t('Langkah berikutnya', 'Next steps')}</div>
            {next.length ? <ul className="stack" style={{ listStyle: 'disc', paddingLeft: 18, marginTop: 8 }}>{next.map(x => <li key={x}>{x}</li>)}</ul>
              : <p className="muted" style={{ marginTop: 8 }}>{t('Pertahankan ritme latihan sekarang.', 'Keep the current practice rhythm.')}</p>}
            {staff && (
              <div className="row" style={{ marginTop: 12, gap: 6 }}>
                {l.is_minor && <Badge tone="low">{t('di bawah 18', 'under 18')}</Badge>}
                <Badge tone={l.ai_consent ? 'good' : 'warn'}>{l.ai_consent ? t('sudah izin AI feedback', 'AI feedback allowed') : t('belum izin AI feedback', 'no AI feedback consent')}</Badge>
              </div>
            )}
          </div>
        </div>
      </Card>

      <Card title={t('Per skill', 'By skill')} sub={t('Titik adalah skor latihan. Garis biru adalah perkiraan level, garis putus-putus ke arah deadline.', 'Dots are practice scores. The blue line is the estimated level, dashed toward the deadline.')} className="anchor" id="skills">
        <div className="skills-grid">
          {traj.map(x => (
            <Trajectory key={x.skill}
              title={<><span>{SKILL_LABEL(x.skill)}</span><span className="muted small">{x.state?.level != null ? `${band(x.state.level)} ±${dec(x.state.levelSd, 1)}` : t('belum ada skor', 'no score yet')}</span></>}
              points={x.points} path={x.path} projection={x.projection} minSkill={min} start={start} end={Math.max(deadline, now + 7 * 86400000)} now={now}
              officials={officials.map(o => ({ at: new Date(o.test_date).getTime(), band: Number(o[x.skill]) }))}
              footer={x.state?.pMin != null ? <>{t(`Peluang mencapai ${band(min)} saat deadline`, `Chance of reaching ${band(min)} by the deadline`)}: <b>{pct(x.state.pMin)}</b></> : null} />
          ))}
        </div>
        <TrajectoryLegend />
      </Card>

      <div className="cols-2" style={{ marginTop: 16 }}>
        <Card title={t('Esai', 'Essays')} sub={essays.length > 8 ? t(`8 terbaru dari ${essays.length}`, `Latest 8 of ${essays.length}`) : undefined} pad={false}>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>{t('Dikirim', 'Submitted')}</th><th className="hide-xs">{t('Soal', 'Prompt')}</th><th className="num">AI</th><th className="num">{t('Guru', 'Teacher')}</th><th>{t('Catatan', 'Notes')}</th></tr></thead>
              <tbody>
                {essays.slice(0, 8).map(e => (
                  <tr key={e.id}>
                    <td style={{ whiteSpace: 'nowrap' }}><Link className="row-link" href={`/essays/${e.id}`}>{date(e.submitted_at)}</Link></td>
                    <td className="muted clip hide-xs" title={e.prompt}>{e.prompt}…</td>
                    <td className="num">{e.status === 'scored' ? <><b>{band(e.overall)}</b> <span className="muted small">{band(e.lo80)}-{band(e.hi80)}</span></> : <Status tone="neutral">{e.status === 'queued' ? t('antre', 'queued') : t('gagal', 'failed')}</Status>}</td>
                    <td className="num">{e.teacher != null ? band(e.teacher) : <span className="muted">-</span>}</td>
                    <td>{(e.flags ?? []).length > 0 && <Badge tone="warn">{staff ? t('perlu dicek', 'needs a look') : t('AI kurang yakin', 'AI unsure')}</Badge>} {e.purged_at && <Badge tone="neutral">{t('teks dihapus', 'text purged')}</Badge>}</td>
                  </tr>
                ))}
                {essays.length === 0 && <tr><td colSpan={5} className="muted">{t('Belum ada esai.', 'No essays yet.')}</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
        <div className="stack-16">
          <Card title={t('Hasil tes resmi', 'Official results')}>
            {officials.length ? (
              <ul className="divided">{officials.map(o => (
                <li key={o.test_date}>
                  <div className="row between">
                    <span>{date(o.test_date)} <span className="muted small">{o.verified === 'trf_verified' ? t('(TRF dicek)', '(TRF checked)') : t('(dilaporkan sendiri)', '(self-reported)')}</span></span>
                    <span className="num">{t('Overall', 'Overall')} <b>{band(o.overall)}</b></span>
                  </div>
                  <Meta items={[`Reading ${band(o.reading)}`, `Listening ${band(o.listening)}`, `Writing ${band(o.writing)}`, `Speaking ${band(o.speaking)}`]} />
                </li>))}
              </ul>
            ) : <p className="muted">{t('Belum ada. Hasil resmi membantu mengoreksi skor latihan.', 'None yet. Real results help correct the practice scores.')}</p>}
          </Card>
          {staff && (me.role === 'inst_admin' || me.role === 'platform') && (
            <Card title={t('Data & persetujuan', 'Data & consent')}>
              <ul className="divided" style={{ marginBottom: 12 }}>
                {consents.length ? consents.map((c, i) => (
                  <li key={i} className="row between"><span>{({ ai_feedback: t('AI feedback', 'AI feedback'), share_with_institution: t('Berbagi ke institusi', 'Share with institution'), audio_retention: t('Simpan audio', 'Keep audio') } as Record<string, string>)[c.scope] ?? c.scope} <span className="muted small">{c.kind === 'guardian' ? t('oleh wali', 'by guardian') : t('oleh learner', 'by learner')}</span></span>
                    <span className="muted small">{c.revoked_at ? `${t('dicabut', 'revoked')} ${date(c.revoked_at)}` : date(c.granted_at)}</span></li>
                )) : <li className="muted">{t('Belum ada persetujuan tercatat.', 'No consent on record.')}</li>}
              </ul>
              <PrivacyActions studentId={id} aiConsent={Boolean(l.ai_consent)} minor={Boolean(l.is_minor)} />
            </Card>
          )}
        </div>
      </div>
    </>
  )
}
