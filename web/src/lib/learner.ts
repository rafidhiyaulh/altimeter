import 'server-only'
import { asUser, n } from './db'
import type { Me } from './auth'
import { prior } from './scoring'
import { filterSkill, SKILLS, type Calibration, type Obs, type Skill } from './readiness'
import type { SkillJson } from './queries'

export async function learnerDetail(me: Me, id: number) {
  return asUser(me, async tx => {
    const [l] = await tx`
      select l.*, c.name as cohort, c.id as cohort_id, c.target_overall, c.target_min_skill, c.deadline::text as deadline,
             i.name as institution, i.serves_minors
      from alt.v_learner l join alt.cohorts c on c.id = l.cohort_id join alt.institutions i on i.id = l.institution_id
      where l.id = ${id}`
    if (!l) return null
    const obs = (await tx`select skill, source, band, taken_at, essay_id from alt.attempts where student_id = ${id} order by taken_at`) as unknown as { skill: string; source: string; band: string; taken_at: Date; essay_id: string | null }[]
    const essays = await tx`
      select v.id, v.submitted_at, v.status, v.overall, v.lo80, v.hi80, v.flags, v.word_count, v.purged_at, v.review_reason, v.reviewed_at,
             left(p.body, 90) as prompt, (select r.overall from alt.reviews r where r.essay_id = v.id order by r.seq desc limit 1) as teacher
      from alt.v_essay_current v join alt.essays e on e.id = v.id join alt.prompts p on p.id = e.prompt_id
      where v.student_id = ${id} order by v.submitted_at desc`
    const officials = await tx`select test_date::text, reading, listening, writing, speaking, overall, verified from alt.official_results where student_id = ${id} order by test_date`
    const consents = await tx`select scope, kind, granted_at, revoked_at from alt.consents where student_id = ${id} order by granted_at desc`
    const [cal] = await tx`select id, entries from alt.calibrations where active`
    return { l, obs, essays, officials, consents, cal: (cal?.entries ?? {}) as Calibration, calId: cal?.id as number | undefined }
  })
}

// The filtered level at every observation (for the chart), plus the projection to the deadline.
export function trajectories(obsRows: { skill: string; source: string; band: unknown; taken_at: string | Date }[], cal: Calibration,
  skills: SkillJson[] | null, deadline: number, now: number) {
  const obs: Obs[] = obsRows.map(o => ({ skill: o.skill as Skill, source: o.source as Obs['source'], band: Number(o.band), at: new Date(o.taken_at).getTime() }))
  return SKILLS.map(skill => {
    const mine = obs.filter(o => o.skill === skill)
    const path = mine.map(o => {
      const f = filterSkill(obs, skill, prior, cal, o.at)
      return f ? { at: o.at, level: f.level, sd: Math.sqrt(f.p11) } : null
    }).filter(Boolean) as { at: number; level: number; sd: number }[]
    const f = filterSkill(obs, skill, prior, cal, now)
    if (f) path.push({ at: now, level: f.level, sd: Math.sqrt(f.p11) })
    const s = skills?.find(x => x.skill === skill) ?? null
    const projection = f && s?.atDeadline != null && s.atDeadlineSd != null
      ? { from: { at: now, level: f.level, sd: Math.sqrt(f.p11) }, to: { at: deadline, level: s.atDeadline, sd: s.atDeadlineSd } } : null
    return { skill, points: mine.map(o => ({ at: o.at, band: o.band, source: o.source })), path, projection, state: s }
  })
}

export const num0 = n
