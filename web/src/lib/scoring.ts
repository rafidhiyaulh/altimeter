import 'server-only'
import modelJson from './essay/model.json'
import lexJson from './essay/lexicon.json'
import priorJson from './readiness-prior.json'
import { scoreEssay, type WritingModel } from './essay/model'
import type { Lexicon } from './essay/features'
import { forecast, type Calibration, type Obs, type Prior, type Target } from './readiness'

export const writingModel = modelJson as unknown as WritingModel
export const lexicon = lexJson as unknown as Lexicon
export const prior = priorJson as unknown as Prior

export function scoreForDb(prompt: string, body: string) {
  const s = scoreEssay(writingModel, lexicon, prompt, body)
  return {
    version: s.version,
    payload: {
      tr: s.bands.TR, cc: s.bands.CC, lr: s.bands.LR, gra: s.bands.GRA, overall: s.overall, overall_raw: s.overallRaw,
      lo80: s.interval80[0], hi80: s.interval80[1], flags: s.flags,
      drivers: s.drivers.map(d => ({ c: d.criterion, f: d.name, v: Math.round(d.value * 1000) / 1000, d: Math.round(d.delta * 1000) / 1000 })),
    },
    score: s,
  }
}

export type LearnerInput = { student_id: number; target: { overall: number; minSkill: number; deadline: number }; obs: Obs[]; calibration: { id: number; entries: Calibration } | null }

export function readinessFor(input: LearnerInput, now = Date.now()) {
  const target: Target = { overall: Number(input.target.overall), minSkill: Number(input.target.minSkill), deadline: Number(input.target.deadline) }
  const obs = input.obs.map(o => ({ ...o, band: Number(o.band), at: Number(o.at) }))
  const r = forecast(obs, target, prior, input.calibration?.entries ?? {}, now, input.student_id)
  const clean = (x: number) => (Number.isFinite(x) ? Math.round(x * 10000) / 10000 : null)
  return {
    ...r,
    calibration_id: input.calibration?.id ?? null,
    pTarget: clean(r.pTarget), pOverall: clean(r.pOverall), overallNow: clean(r.overallNow), overallAtDeadline: clean(r.overallAtDeadline),
    skills: r.skills.map(s => ({ skill: s.skill, n: s.n, level: clean(s.level), levelSd: clean(s.levelSd), slope: clean(s.slope), slopeSd: clean(s.slopeSd),
      lastAt: s.lastAt, atDeadline: clean(s.atDeadline), atDeadlineSd: clean(s.atDeadlineSd), pMin: clean(s.pMin), neededPerWeek: clean(s.neededPerWeek) })),
  }
}
