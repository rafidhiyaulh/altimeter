// Readiness forecast: where is each skill now, how fast is it moving, and what is the chance of meeting the
// target by the deadline. One Kalman filter per skill with a local linear trend (level + weekly growth),
// so every number is explainable: "Writing is about 5.6 (5.2 to 6.0), growing 0.03 band a week; to reach
// 6.0 by 15 Dec it needs 0.06 a week".
// Plain, erasable TypeScript only (also run by scripts/backtest-readiness.mjs).

export const SKILLS = ['reading', 'listening', 'writing', 'speaking'] as const
export type Skill = (typeof SKILLS)[number]
export type Source = 'practice' | 'mock' | 'ai_writing' | 'ai_speaking' | 'official'

export type Obs = { skill: Skill; source: Source; band: number; at: number } // at: epoch ms
export type Prior = {
  version: string
  slope: Record<Skill, { mean: number; sd: number; p90: number }>
  noise: Record<Source, number>        // observation sd (band)
  processLevel: number                 // level drift sd per sqrt(week)
  processSlope: number                 // growth drift sd per sqrt(week)
}
// Correction from an observed band to the official scale, learned from learners who sat the real test:
// official ~ observed + a. Offset only, on purpose: a fitted slope looks better on paper but is attenuated
// by practice-score noise and then shrunk again when the filter averages observations (backtest: worse).
export type CalEntry = { a: number; b: number; n: number }
export type Calibration = Partial<Record<`${Skill}:${Source}`, CalEntry>>

export function calibrated(cal: Calibration, o: Obs): number {
  const c = cal[`${o.skill}:${o.source}`]
  return c ? c.a + c.b * o.band : o.band
}

// Mean official-minus-observed over pairs (observation within three weeks of the official test).
// Needs at least 15 pairs; shrunk toward zero with k pseudo-pairs so a small sample cannot swing it far.
export function fitCalibration(pairs: { x: number; y: number }[], k = 10): CalEntry | null {
  const n = pairs.length
  if (n < 15) return null
  const d = pairs.reduce((a, p) => a + (p.y - p.x), 0)
  return { a: d / (n + k), b: 1, n }
}

export type Target = { overall: number; minSkill: number; deadline: number }

export type SkillState = {
  skill: Skill
  n: number
  level: number
  levelSd: number
  slope: number
  slopeSd: number
  lastAt: number | null
  atDeadline: number
  atDeadlineSd: number
  pMin: number            // P(skill band >= minSkill at deadline)
  neededPerWeek: number   // weekly growth needed to reach the binding requirement for this skill
}

export type Readiness = {
  version: string
  status: 'on_track' | 'watch' | 'at_risk' | 'insufficient_data'
  pTarget: number         // P(overall >= target AND every skill >= minSkill) at the deadline
  pOverall: number
  overallNow: number
  overallAtDeadline: number
  weeksLeft: number
  binding: Skill | null   // the skill that most limits the chance
  priority: number        // intervention priority 0..1 (higher = act first)
  recoverable: boolean    // needed growth is within what 90% of learners manage
  skills: SkillState[]
}

const WEEK = 7 * 24 * 3600 * 1000

// IELTS: each skill band and the overall are reported in half bands; .25 and .75 round up.
export const ieltsRound = (x: number) => Math.floor(x * 2 + 0.5) / 2

function normCdf(z: number): number {
  // Abramowitz-Stegun 7.1.26 via erf; |error| < 1.5e-7
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2)
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2)
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2
}

// Deterministic RNG so the same data always gives the same probability (mulberry32 + Box-Muller).
function rng(seed: number) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  let spare: number | null = null
  return () => {
    if (spare != null) { const s = spare; spare = null; return s }
    let u = 0
    while (u === 0) u = next()
    const v = next()
    const r = Math.sqrt(-2 * Math.log(u))
    spare = r * Math.sin(2 * Math.PI * v)
    return r * Math.cos(2 * Math.PI * v)
  }
}

export function filterSkill(obs: Obs[], skill: Skill, prior: Prior, cal: Calibration, now: number) {
  const xs = obs.filter(o => o.skill === skill && o.at <= now).sort((a, b) => a.at - b.at)
  const sp = prior.slope[skill]
  if (xs.length === 0) return null
  // state m = [level, slope], covariance P (2x2 symmetric: p11, p12, p22)
  const first = xs[0]
  let l = calibrated(cal, first)
  let s = sp.mean
  let p11 = prior.noise[first.source] ** 2
  let p12 = 0
  let p22 = sp.sd ** 2
  let t = first.at
  for (const o of xs.slice(1)) {
    const dt = Math.max(0, (o.at - t) / WEEK)
    // predict
    l = l + s * dt
    const n11 = p11 + 2 * dt * p12 + dt * dt * p22 + prior.processLevel ** 2 * dt
    const n12 = p12 + dt * p22
    const n22 = p22 + prior.processSlope ** 2 * dt
    p11 = n11; p12 = n12; p22 = n22
    // update with y = level + noise
    const y = calibrated(cal, o)
    const r = prior.noise[o.source] ** 2
    const S = p11 + r
    const k1 = p11 / S
    const k2 = p12 / S
    const innov = y - l
    l += k1 * innov
    s += k2 * innov
    const u11 = (1 - k1) * p11
    const u12 = (1 - k1) * p12
    const u22 = p22 - k2 * p12
    p11 = u11; p12 = u12; p22 = u22
    t = o.at
  }
  // roll forward to now (no observation)
  const dtNow = Math.max(0, (now - t) / WEEK)
  const levelNow = l + s * dtNow
  const v11 = p11 + 2 * dtNow * p12 + dtNow * dtNow * p22 + prior.processLevel ** 2 * dtNow
  const v12 = p12 + dtNow * p22
  const v22 = p22 + prior.processSlope ** 2 * dtNow
  return { n: xs.length, level: levelNow, slope: s, p11: v11, p12: v12, p22: v22, lastAt: t }
}

export function forecast(obs: Obs[], target: Target, prior: Prior, cal: Calibration, now: number, seed = 1): Readiness {
  const weeksLeft = Math.max(0, (target.deadline - now) / WEEK)
  const skills: SkillState[] = []
  for (const skill of SKILLS) {
    const f = filterSkill(obs, skill, prior, cal, now)
    if (!f) {
      skills.push({ skill, n: 0, level: Number.NaN, levelSd: Number.NaN, slope: prior.slope[skill].mean, slopeSd: prior.slope[skill].sd,
        lastAt: null, atDeadline: Number.NaN, atDeadlineSd: Number.NaN, pMin: Number.NaN, neededPerWeek: Number.NaN })
      continue
    }
    // Growth only continues while the learner keeps practising: if the last attempt is older than
    // three weeks, project with no further growth (and say so in the UI).
    const active = now - f.lastAt <= 3 * WEEK
    const s = active ? f.slope : 0
    const dt = weeksLeft
    const mu = f.level + s * dt
    const varT = f.p11 + (active ? 2 * dt * f.p12 + dt * dt * f.p22 : 0) + prior.processLevel ** 2 * dt
    const sdT = Math.sqrt(Math.max(1e-6, varT))
    const need = Math.max(target.minSkill, target.overall - 0.5)
    skills.push({
      skill, n: f.n, level: f.level, levelSd: Math.sqrt(Math.max(1e-6, f.p11)), slope: f.slope, slopeSd: Math.sqrt(Math.max(1e-6, f.p22)),
      lastAt: f.lastAt, atDeadline: mu, atDeadlineSd: sdT,
      pMin: 1 - normCdf((target.minSkill - 0.25 - mu) / sdT),
      neededPerWeek: weeksLeft > 0 ? (need - f.level) / weeksLeft : need > f.level ? Number.POSITIVE_INFINITY : 0,
    })
  }

  const known = skills.filter(s => s.n > 0)
  // One observation per skill is enough to forecast (with a wide interval); fewer than six in total is not.
  const thin = known.reduce((a, s) => a + s.n, 0) < 6
  if (known.length < SKILLS.length) {
    return { version: prior.version, status: 'insufficient_data', pTarget: Number.NaN, pOverall: Number.NaN, overallNow: Number.NaN,
      overallAtDeadline: Number.NaN, weeksLeft, binding: null, priority: 0, recoverable: true, skills }
  }

  // Monte Carlo over the four skills at the deadline, with IELTS rounding at each step.
  const draw = rng(seed)
  const N = 4000
  let hitAll = 0
  let hitOverall = 0
  const misses = new Map<Skill, number>()
  for (let i = 0; i < N; i++) {
    let sum = 0
    let allMin = true
    for (const s of skills) {
      const b = Math.min(9, Math.max(1, ieltsRound(s.atDeadline + s.atDeadlineSd * draw())))
      sum += b
      if (b < target.minSkill) { allMin = false; misses.set(s.skill, (misses.get(s.skill) ?? 0) + 1) }
    }
    const overall = ieltsRound(sum / 4)
    if (overall >= target.overall) hitOverall++
    if (overall >= target.overall && allMin) hitAll++
  }
  const pTarget = hitAll / N
  const overallNow = ieltsRound(skills.reduce((a, s) => a + s.level, 0) / 4)
  const overallAtDeadline = skills.reduce((a, s) => a + s.atDeadline, 0) / 4

  // Binding skill: the one most often below the minimum, else the lowest projected skill.
  let binding: Skill | null = null
  let worst = -1
  for (const [k, v] of misses) if (v > worst) { worst = v; binding = k }
  if (!binding) binding = [...skills].sort((a, b) => a.atDeadline - b.atDeadline)[0].skill
  const b = skills.find(s => s.skill === binding)!
  // Reachability: how the weekly gain this learner needs compares with what the fastest 10% of learners
  // manage (p90 pace). 1 when within it, falling quickly beyond it.
  const p90 = prior.slope[b.skill].p90
  const reach = !(b.neededPerWeek > 0) ? 1 : Math.min(1, p90 / b.neededPerWeek) ** 2
  const recoverable = reach >= 0.5

  const status: Readiness['status'] = thin ? 'insufficient_data' : pTarget >= 0.7 ? 'on_track' : pTarget >= 0.4 ? 'watch' : 'at_risk'
  // Act first where help can still change the outcome: likely to miss, and the needed pace is reachable.
  const priority = thin || weeksLeft <= 0 ? 0 : (1 - pTarget) * reach
  return { version: prior.version, status, pTarget, pOverall: hitOverall / N, overallNow, overallAtDeadline, weeksLeft, binding, priority, recoverable, skills }
}
