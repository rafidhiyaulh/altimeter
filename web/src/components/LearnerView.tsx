import Link from 'next/link'
import type { Me } from '@/lib/auth'
import { n } from '@/lib/db'
import { getT } from '@/lib/i18n-server'
import { learnerDetail, trajectories } from '@/lib/learner'
import { ago, band, date, dec, num, pct, requestNow, signed } from '@/lib/format'
import { Badge, Card, Empty, Facts, PageHead, ReadyBadge, SKILL_LABEL, Status } from './ui'
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

  const sentence = l.status === 'insufficient_data' || p == null
    ? t('Data belum cukup. Ikuti satu mock test lengkap.', 'Not enough data. Take one full mock test.')
    : binding
      ? t(`Penentu: ${SKILL_LABEL(l.binding)}, ${band(binding.level)} sekarang, ${signed(binding.slope, 2)}/mgg. Perlu ${binding.neededPerWeek != null && binding.neededPerWeek > 0 ? `+${dec(binding.neededPerWeek, 2)}` : '0'}/mgg untuk ${band(Math.max(min, target - 0.5))} pada ${date(l.deadline)}.`,
          `Bottleneck: ${SKILL_LABEL(l.binding)}, ${band(binding.level)} now, ${signed(binding.slope, 2)}/wk. Needs ${binding.neededPerWeek != null && binding.neededPerWeek > 0 ? `+${dec(binding.neededPerWeek, 2)}` : '0'}/wk to reach ${band(Math.max(min, target - 0.5))} by ${date(l.deadline)}.`)
      : ''

  const next: string[] = []
  if (l.status === 'insufficient_data') next.push(t('Ikuti satu mock test.', 'Take one mock test.'))
  if (inactive) next.push(t('Tidak latihan 3 minggu: proyeksi tanpa kenaikan.', 'No practice in 3 weeks: projection assumes no gain.'))
  if (l.binding === 'writing') next.push(t('Satu esai Task 2 per minggu.', 'One Task 2 essay a week.'))
  if (l.binding === 'speaking') next.push(t('Dua sesi speaking per minggu (Part 2).', 'Two speaking sessions a week (Part 2).'))
  if (l.binding === 'reading' || l.binding === 'listening') next.push(t('Satu set latihan berwaktu per minggu.', 'One timed practice set a week.'))

  return (
    <>
      {!self && <Link href={`/cohorts/${l.cohort_id}`} className="back">← {l.cohort}</Link>}
      <PageHead title={self ? t('Kesiapan saya', 'My readiness') : l.display_name}
        sub={`${l.cohort} · ${l.institution} · ${t('target', 'target')} ${band(target)}, ${t('tiap skill minimal', 'every skill at least')} ${band(min)} · ${date(l.deadline)}`}>
        {self && <Link href="/write" className="btn btn-primary">{t('Tulis esai', 'Write an essay')}</Link>}
      </PageHead>

      <div className="cols-2">
        <Card>
          <div className="row" style={{ alignItems: 'flex-start', gap: 28 }}>
            <div>
              <div className="muted small"><Term k="p_target">{t('Peluang mencapai target', 'Chance of reaching the target')}</Term></div>
              <div className="big-p">{p == null ? '-' : pct(p)}</div>
              <div style={{ marginTop: 6 }}><ReadyBadge status={l.status} /></div>
            </div>
            <div style={{ flex: 1, minWidth: 240 }}>
              <p style={{ lineHeight: 1.55 }}>{sentence}</p>
              <div style={{ marginTop: 12 }}>
                <Facts tight items={[
                  { label: t('Overall sekarang', 'Overall today'), value: band(l.overall_now) },
                  { label: t('Perkiraan saat deadline', 'Forecast at deadline'), value: band(n(l.overall_at_deadline) != null ? Math.floor(n(l.overall_at_deadline)! * 2 + 0.5) / 2 : null) },
                  { label: t('Aktivitas 14 hari', 'Activity, 14 days'), value: `${num(l.attempts_14d)} ${t('latihan', 'attempts')}` },
                  { label: t('Terakhir aktif', 'Last active'), value: l.last_activity ? ago(l.last_activity) : '-' },
                ]} />
              </div>
            </div>
          </div>
        </Card>
        <Card title={t('Langkah berikutnya', 'Next steps')}>
          {next.length ? <ul className="stack" style={{ listStyle: 'disc', paddingLeft: 18 }}>{next.map(x => <li key={x}>{x}</li>)}</ul>
            : <p className="muted">{t('Pertahankan ritme latihan sekarang.', 'Keep the current practice rhythm.')}</p>}
          {staff && (
            <div className="row" style={{ marginTop: 12, gap: 6 }}>
              {l.is_minor && <Badge tone="low">{t('di bawah 18', 'under 18')}</Badge>}
              <Badge tone={l.ai_consent ? 'good' : 'warn'}>{l.ai_consent ? t('izin AI feedback ada', 'AI feedback consent on file') : t('tanpa izin AI feedback', 'no AI feedback consent')}</Badge>
              {l.synthetic_engagement && <Badge tone="neutral" title={t('Hanya data demo: cara generator membuat learner ini', 'Demo data only: how the generator made this learner')}>{t('sintetis', 'synthetic')}: {l.synthetic_engagement}</Badge>}
            </div>
          )}
        </Card>
      </div>

      <Card title={t('Per skill', 'By skill')} sub={t('Titik = skor, garis = level, putus-putus = proyeksi.', 'Dots = scores, line = level, dashed = projection.')} className="anchor" id="skills">
        <div className="skills-grid">
          {traj.map(x => (
            <Trajectory key={x.skill}
              title={<><span>{SKILL_LABEL(x.skill)}</span><span className="muted small">{x.state?.level != null ? `${band(x.state.level)} ±${dec(x.state.levelSd, 1)}` : t('belum ada skor', 'no score yet')}</span></>}
              points={x.points} path={x.path} projection={x.projection} minSkill={min} start={start} end={Math.max(deadline, now + 7 * 86400000)} now={now}
              officials={officials.map(o => ({ at: new Date(o.test_date).getTime(), band: Number(o[x.skill]) }))}
              footer={x.state?.pMin != null ? <>{t('Peluang ≥ minimum saat deadline', 'Chance ≥ minimum at deadline')}: <b>{pct(x.state.pMin)}</b> · {t('laju', 'pace')} {signed(x.state.slope, 2)}/{t('mgg', 'wk')}</> : null} />
          ))}
        </div>
        <TrajectoryLegend />
      </Card>

      <div className="cols-2" style={{ marginTop: 16 }}>
        <Card title={t('Esai', 'Essays')} sub={t('Skor AI; sebagian dicek guru.', 'AI scores; some checked by a teacher.')} pad={false}>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>{t('Dikirim', 'Submitted')}</th><th>{t('Soal', 'Prompt')}</th><th className="num">AI</th><th className="num">{t('Guru', 'Teacher')}</th><th>{t('Catatan', 'Notes')}</th></tr></thead>
              <tbody>
                {essays.slice(0, 15).map(e => (
                  <tr key={e.id}>
                    <td style={{ whiteSpace: 'nowrap' }}><Link className="row-link" href={`/essays/${e.id}`}>{date(e.submitted_at)}</Link></td>
                    <td className="muted clip" title={e.prompt}>{e.prompt}…</td>
                    <td className="num">{e.status === 'scored' ? <><b>{band(e.overall)}</b> <span className="muted small">{band(e.lo80)}-{band(e.hi80)}</span></> : <Status tone="neutral">{e.status === 'queued' ? t('antre', 'queued') : t('gagal', 'failed')}</Status>}</td>
                    <td className="num">{e.teacher != null ? band(e.teacher) : <span className="muted">-</span>}</td>
                    <td>{(e.flags ?? []).length > 0 && <Badge tone="warn">{t('perlu dicek', 'check')}</Badge>} {e.purged_at && <Badge tone="neutral">{t('teks dihapus', 'text purged')}</Badge>}</td>
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
                <li key={o.test_date} className="row between">
                  <span>{date(o.test_date)} <span className="muted small">{o.verified === 'trf_verified' ? t('TRF terverifikasi', 'TRF verified') : t('dilaporkan sendiri', 'self-reported')}</span></span>
                  <span className="num"><b>{band(o.overall)}</b> <span className="muted small">R {band(o.reading)} · L {band(o.listening)} · W {band(o.writing)} · S {band(o.speaking)}</span></span>
                </li>))}
              </ul>
            ) : <p className="muted">{t('Belum ada.', 'None yet.')}</p>}
          </Card>
          {staff && (me.role === 'inst_admin' || me.role === 'platform') && (
            <Card title={t('Data & persetujuan', 'Data & consent')}>
              <ul className="divided" style={{ marginBottom: 12 }}>
                {consents.length ? consents.map((c, i) => (
                  <li key={i} className="row between"><span>{c.scope.replace(/_/g, ' ')} <span className="muted small">{c.kind === 'guardian' ? t('oleh wali', 'by guardian') : t('oleh learner', 'by learner')}</span></span>
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
