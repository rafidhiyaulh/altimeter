import 'server-only'
import { asUser, n, type Tx } from './db'
import type { Me } from './auth'
import { chat, grounded, parseJson } from './llm'
import type { Lang } from './i18n'

// Weekly cohort report. Facts are computed in SQL and numbered (F1, F2, ...); the LLM may only restate them
// and must cite the ids. No learner name or id ever goes to the LLM: the named list of who to help is added
// by the app from the database, outside the generated text.

export type Fact = { id: string; label: string; value: number | string }

export async function cohortFacts(tx: Tx, cohortId: number): Promise<{ facts: Fact[]; cohort: string; deadline: string }> {
  const [c] = await tx`select name, deadline::text, target_overall, target_min_skill, weekly_capacity from alt.cohorts where id = ${cohortId}`
  const [s] = await tx`
    with cur as (select r.* from alt.readiness r join alt.students s on s.id = r.student_id where s.cohort_id = ${cohortId} and r.valid_to is null and s.erased_at is null),
    old as (select r.* from alt.readiness r join alt.students s on s.id = r.student_id where s.cohort_id = ${cohortId} and s.erased_at is null
            and r.valid_from <= now() - interval '7 days' and (r.valid_to is null or r.valid_to > now() - interval '7 days'))
    select (select count(*) from cur)::int as learners,
      (select count(*) from cur where status = 'on_track')::int as on_track, (select count(*) from cur where status = 'watch')::int as watch,
      (select count(*) from cur where status = 'at_risk')::int as at_risk, (select count(*) from cur where status = 'insufficient_data')::int as no_data,
      -- week-ago figures only when forecasts existed a week ago (null facts are left out)
      (select case when count(*) > 0 then count(*) filter (where status = 'at_risk') end from old)::int as at_risk_7d,
      (select case when count(*) > 0 then count(*) filter (where status = 'on_track') end from old)::int as on_track_7d,
      (select round(avg(p_target)::numeric * 100) from cur where p_target is not null) as avg_p,
      (select binding from cur where status in ('at_risk', 'watch') group by binding order by count(*) desc limit 1) as top_binding,
      (select count(*) from cur where status in ('at_risk', 'watch') and binding = (select binding from cur where status in ('at_risk', 'watch') group by binding order by count(*) desc limit 1))::int as top_binding_n,
      (select count(*) from alt.attempts a join alt.students st on st.id = a.student_id where st.cohort_id = ${cohortId} and a.taken_at > now() - interval '7 days')::int as attempts_7d,
      (select count(*) from alt.students st where st.cohort_id = ${cohortId} and st.erased_at is null and not exists
        (select 1 from alt.attempts a where a.student_id = st.id and a.taken_at > now() - interval '21 days'))::int as inactive_21d,
      (select count(*) from alt.reviews r join alt.essays e on e.id = r.essay_id join alt.students st on st.id = e.student_id where st.cohort_id = ${cohortId})::int as reviews,
      (select round(avg(r.ai_overall - r.overall), 2) from alt.reviews r join alt.essays e on e.id = r.essay_id join alt.students st on st.id = e.student_id where st.cohort_id = ${cohortId}) as ai_bias`
  const weeks = Math.max(0, Math.round((new Date(c.deadline).getTime() - Date.now()) / (7 * 86400000)))
  const raw: [string, number | string | null][] = [
    ['learners', s.learners], ['weeks_to_deadline', weeks], ['target_overall', n(c.target_overall)], ['target_min_skill', n(c.target_min_skill)],
    ['on_track', s.on_track], ['watch', s.watch], ['at_risk', s.at_risk], ['not_enough_data', s.no_data],
    ['at_risk_7_days_ago', s.at_risk_7d], ['on_track_7_days_ago', s.on_track_7d], ['average_chance_percent', n(s.avg_p)],
    ['most_common_binding_skill', s.top_binding], ['learners_held_back_by_that_skill', s.top_binding_n],
    ['practice_attempts_last_7_days', s.attempts_7d], ['learners_inactive_21_days', s.inactive_21d],
    ['coaching_slots_per_week', c.weekly_capacity], ['teacher_reviews_total', s.reviews], ['ai_minus_teacher_band', n(s.ai_bias)],
  ]
  const facts = raw.filter(([, v]) => v != null).map(([label, value], i) => ({ id: `F${i + 1}`, label, value: value as number | string }))
  return { facts, cohort: c.name, deadline: c.deadline }
}

export type Report = { headline: string; bullets: { text: string; facts: string[] }[]; actions: string[] }

const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['headline', 'bullets', 'actions'],
  properties: {
    headline: { type: 'string' },
    bullets: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['text', 'facts'],
      properties: { text: { type: 'string' }, facts: { type: 'array', items: { type: 'string' } } } } },
    actions: { type: 'array', items: { type: 'string' } },
  },
}

export async function draftReport(facts: Fact[], cohort: string, lang: Lang) {
  const sys = [
    `You write a short weekly readiness report for the head of an English test-prep cohort. Language: ${lang === 'id' ? 'Bahasa Indonesia' : 'English'}.`,
    'Use ONLY the numbered facts. Every bullet must list the fact ids it uses in "facts". Never invent or compute new numbers; restate the given ones.',
    'Write a one-sentence headline, 3 to 5 bullets, and 2 or 3 concrete actions for this week. Plain language, no jargon, no learner names.',
  ].join('\n')
  const r = await chat([{ role: 'system', content: sys }, { role: 'user', content: `Cohort: ${cohort}\nFacts:\n${facts.map(f => `${f.id} ${f.label} = ${f.value}`).join('\n')}` }], { json: SCHEMA, maxTokens: 900 })
  const out = parseJson<Report>(r.text)
  if (!out) return { report: null, dropped: 0, ms: r.ms, sha: r.sha }
  const ids = new Set(facts.map(f => f.id))
  const values = facts.map(f => f.value)
  let dropped = 0
  const bullets = (out.bullets ?? []).filter(b => {
    const ok = b.facts?.length > 0 && b.facts.every(id => ids.has(id)) && grounded(b.text.replace(/\bF\d+\b/g, ''), values).ok
    if (!ok) dropped++
    return ok
  })
  const headline = grounded(out.headline ?? '', values).ok ? out.headline : ''
  const actions = (out.actions ?? []).filter(a => grounded(a, values).ok)
  if (bullets.length < 2) return { report: null, dropped, ms: r.ms, sha: r.sha }
  return { report: { headline, bullets, actions }, dropped, ms: r.ms, sha: r.sha }
}

export function rulesReport(facts: Fact[], lang: Lang): Report {
  const f = Object.fromEntries(facts.map(x => [x.label, x]))
  const v = (k: string) => f[k]?.value
  const id = (...k: string[]) => k.map(x => f[x]?.id).filter(Boolean) as string[]
  const en = lang === 'en'
  const bullets: Report['bullets'] = [
    { text: en ? `${v('on_track')} of ${v('learners')} learners are on track; ${v('at_risk')} are at risk and ${v('watch')} need watching.`
      : `${v('on_track')} dari ${v('learners')} learner sesuai jalur; ${v('at_risk')} berisiko dan ${v('watch')} perlu dipantau.`, facts: id('on_track', 'learners', 'at_risk', 'watch') },
  ]
  if (v('at_risk_7_days_ago') != null) bullets.push({ text: en ? `A week ago ${v('at_risk_7_days_ago')} were at risk; now ${v('at_risk')}.`
    : `Seminggu lalu ${v('at_risk_7_days_ago')} berisiko; sekarang ${v('at_risk')}.`, facts: id('at_risk_7_days_ago', 'at_risk') })
  if (v('most_common_binding_skill')) bullets.push({ text: en ? `${v('most_common_binding_skill')} holds back ${v('learners_held_back_by_that_skill')} learners who are not yet safe.`
    : `${v('most_common_binding_skill')} menghambat ${v('learners_held_back_by_that_skill')} learner yang belum aman.`, facts: id('most_common_binding_skill', 'learners_held_back_by_that_skill') })
  bullets.push({ text: en ? `${v('learners_inactive_21_days')} learners have not practised in 21 days.` : `${v('learners_inactive_21_days')} learner tidak berlatih 21 hari terakhir.`, facts: id('learners_inactive_21_days') })
  return {
    headline: en ? `${v('weeks_to_deadline')} weeks to the deadline: ${v('at_risk')} learners at risk.` : `${v('weeks_to_deadline')} minggu menuju deadline: ${v('at_risk')} learner berisiko.`,
    bullets,
    actions: [
      en ? `Use this week's ${v('coaching_slots_per_week')} coaching slots on the top of the intervention queue.` : `Pakai ${v('coaching_slots_per_week')} slot coaching minggu ini untuk puncak antrean intervensi.`,
      en ? `Run one group class on ${v('most_common_binding_skill') ?? 'the weakest skill'}.` : `Adakan satu kelas kelompok untuk ${v('most_common_binding_skill') ?? 'skill terlemah'}.`,
    ],
  }
}

export async function topLearners(me: Me, cohortId: number, k: number) {
  return asUser(me, tx => tx`select id, display_name, status, p_target, binding from alt.v_learner
    where cohort_id = ${cohortId} and erased_at is null and status in ('at_risk', 'watch') order by priority desc limit ${k}`)
}
