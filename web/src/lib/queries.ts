import 'server-only'
import { asUser, n } from './db'
import type { Me } from './auth'

export type CohortRow = {
  id: number; name: string; institution: string; target_overall: number; target_min_skill: number; deadline: string
  weekly_capacity: number; learners: number; on_track: number; watch: number; at_risk: number; insufficient_data: number
  median_p: number | null; newly_at_risk: number; reviews_open: number; active_14d: number
}

// One row per visible cohort. "Newly at risk" uses the bitemporal history: at risk now, while the forecast
// in force seven days ago said something else (no forecast back then counts as not new).
export async function cohorts(me: Me): Promise<CohortRow[]> {
  const rows = await asUser(me, tx => tx`
    select c.id, c.name, i.name as institution, c.target_overall, c.target_min_skill, c.deadline::text, c.weekly_capacity,
      count(s.id)::int as learners,
      count(*) filter (where r.status = 'on_track')::int as on_track,
      count(*) filter (where r.status = 'watch')::int as watch,
      count(*) filter (where r.status = 'at_risk')::int as at_risk,
      count(*) filter (where r.status = 'insufficient_data' or r.status is null)::int as insufficient_data,
      percentile_cont(0.5) within group (order by r.p_target) as median_p,
      count(*) filter (where r.status = 'at_risk' and exists (
        select 1 from alt.readiness r7 where r7.student_id = s.id and r7.status <> 'at_risk' and r7.valid_from <= now() - interval '7 days'
          and (r7.valid_to is null or r7.valid_to > now() - interval '7 days')))::int as newly_at_risk,
      (select count(*) from alt.review_queue q join alt.essays e on e.id = q.essay_id join alt.students s2 on s2.id = e.student_id
        where s2.cohort_id = c.id and q.done_at is null)::int as reviews_open,
      count(*) filter (where exists (select 1 from alt.attempts a where a.student_id = s.id and a.taken_at > now() - interval '14 days'))::int as active_14d
    from alt.cohorts c join alt.institutions i on i.id = c.institution_id
    left join alt.students s on s.cohort_id = c.id and s.erased_at is null
    left join alt.readiness r on r.student_id = s.id and r.valid_to is null
    group by c.id, i.name order by c.deadline, c.id`)
  return rows.map(r => ({ ...r, target_overall: n(r.target_overall)!, target_min_skill: n(r.target_min_skill)!, median_p: n(r.median_p) })) as unknown as CohortRow[]
}

export type LearnerRow = {
  id: number; display_name: string; status: string | null; p_target: number | null; overall_now: number | null; binding: string | null
  priority: number; recoverable: boolean; skills: SkillJson[] | null; last_activity: string | null; attempts_14d: number
  essays: number; is_minor: boolean; ai_consent: boolean; synthetic_engagement: string | null; weeks_left: number | null
}
export type SkillJson = { skill: string; n: number; level: number | null; levelSd: number | null; slope: number | null; atDeadline: number | null
  atDeadlineSd: number | null; pMin: number | null; neededPerWeek: number | null; lastAt: number | null }

export async function learners(me: Me, cohortId: number): Promise<LearnerRow[]> {
  const rows = await asUser(me, tx => tx`
    select l.id, l.display_name, l.status, l.p_target, l.overall_now, l.binding, coalesce(l.priority, 0) as priority,
      coalesce(l.recoverable, true) as recoverable, l.skills, l.last_activity, l.attempts_14d::int, l.is_minor, l.ai_consent,
      l.synthetic_engagement, l.weeks_left,
      (select count(*) from alt.essays e where e.student_id = l.id)::int as essays
    from alt.v_learner l where l.cohort_id = ${cohortId} and l.erased_at is null
    order by coalesce(l.priority, 0) desc, l.p_target nulls last, l.id`)
  return rows.map(r => ({ ...r, p_target: n(r.p_target), overall_now: n(r.overall_now), priority: Number(r.priority), weeks_left: n(r.weeks_left) })) as unknown as LearnerRow[]
}

export const skillOf = (skills: SkillJson[] | null, k: string | null) => skills?.find(s => s.skill === k) ?? null
