// Backtest the readiness forecast on the synthetic cohorts: for every learner with an official result,
// forecast each skill AT the official test date using only what was observed before it, then compare.
// Writing observations are the real model's scores of the real essays (same code as the worker).
// Calibration is learned on half of the learners and applied to the other half (no peeking).
// usage: node scripts/backtest-readiness.mjs ../ml/data/work ../ml/artifacts/readiness_backtest.json
import { readFileSync, writeFileSync } from 'node:fs'
import { forecast, filterSkill, fitCalibration, SKILLS, ieltsRound } from '../src/lib/readiness.ts'
import { scoreEssay } from '../src/lib/essay/model.ts'

const [dir, dst] = process.argv.slice(2)
const synth = JSON.parse(readFileSync(`${dir}/synth.json`, 'utf8'))
const prior = JSON.parse(readFileSync(new URL('../src/lib/readiness-prior.json', import.meta.url), 'utf8'))
const model = JSON.parse(readFileSync(new URL('../src/lib/essay/model.json', import.meta.url), 'utf8'))
const lex = JSON.parse(readFileSync(new URL('../src/lib/essay/lexicon.json', import.meta.url), 'utf8'))
const corpus = new Map(readFileSync(`${dir}/essays.jsonl`, 'utf8').split('\n').filter(Boolean).map(l => { const r = JSON.parse(l); return [r.id, r] }))

const DAY = 86400000
const T0 = Date.UTC(2026, 6, 6)
const at = d => T0 + d * DAY
const obsBy = new Map()
const add = (sid, o) => { if (!obsBy.has(sid)) obsBy.set(sid, []); obsBy.get(sid).push(o) }
for (const a of synth.attempts) add(a.sid, { skill: a.skill, source: a.source, band: a.band, at: at(a.day) })
let aiVsLatent = []
const students = new Map(synth.students.map(s => [s.sid, s]))
for (const e of synth.essays) {
  const r = corpus.get(e.essay_id)
  const s = scoreEssay(model, lex, r.topic, r.essay)
  add(e.sid, { skill: 'writing', source: 'ai_writing', band: s.overall, at: at(e.day) })
  const st = students.get(e.sid)
  aiVsLatent.push(s.overall - (st.base.writing + st.slope.writing * e.day / 7))
}

const cohortOf = new Map(synth.institutions.flatMap(i => i.cohorts.map(c => [c.key, c])))
const half = sid => sid % 2 // calibration learned on one half, evaluated on the other

function evaluate(cal, which) {
  const rows = []
  for (const off of synth.officials) {
    if (half(off.sid) !== which) continue
    const obs = obsBy.get(off.sid) ?? []
    const when = at(off.day)
    for (const skill of SKILLS) {
      const f = filterSkill(obs, skill, prior, cal, when)
      if (!f || f.n < 2) continue
      const sd = Math.sqrt(f.p11)
      rows.push({ skill, pred: f.level, sd, official: off[skill], err: f.level - off[skill] })
    }
  }
  const by = {}
  for (const skill of SKILLS) {
    const r = rows.filter(x => x.skill === skill)
    const mae = r.reduce((a, b) => a + Math.abs(b.err), 0) / r.length
    const bias = r.reduce((a, b) => a + b.err, 0) / r.length
    // 80% interval: +-1.2816 sd, widened by the official test's own rounding/noise (0.2 band + half-band rounding)
    const cover = r.filter(x => Math.abs(x.err) <= 1.2816 * Math.sqrt(x.sd ** 2 + 0.2 ** 2 + 0.144 ** 2)).length / r.length
    const within = r.filter(x => Math.abs(ieltsRound(x.pred) - x.official) <= 0.5).length / r.length
    by[skill] = { n: r.length, mae: +mae.toFixed(3), bias: +bias.toFixed(3), within_half: +within.toFixed(3), coverage80: +cover.toFixed(3) }
  }
  return by
}

// Learn calibration (official ~ a + b * observed, observations within 3 weeks of the test) on half 0.
const cal = {}
const pairs = {}
for (const off of synth.officials) {
  if (half(off.sid) !== 0) continue
  for (const o of obsBy.get(off.sid) ?? []) {
    if (Math.abs(o.at - at(off.day)) > 21 * DAY) continue
    const k = `${o.skill}:${o.source}`
    ;(pairs[k] ??= []).push({ x: o.band, y: off[o.skill] })
  }
}
for (const [k, v] of Object.entries(pairs)) {
  const c = fitCalibration(v)
  if (c) cal[k] = { a: +c.a.toFixed(3), b: +c.b.toFixed(3), n: c.n }
}

// Probability calibration: P(target) a week before... use the official date as the deadline.
function brier(calib) {
  let s = 0, n = 0, buckets = Array.from({ length: 5 }, () => ({ p: 0, y: 0, n: 0 }))
  for (const off of synth.officials) {
    if (half(off.sid) !== 1) continue
    const st = students.get(off.sid)
    const co = cohortOf.get(st.cohort)
    const when = at(off.day)
    const r = forecast(obsBy.get(off.sid) ?? [], { overall: co.target, minSkill: co.min, deadline: when }, prior, calib, when - 28 * DAY, off.sid)
    if (!Number.isFinite(r.pTarget)) continue
    const y = off.overall >= co.target && SKILLS.every(k => off[k] >= co.min) ? 1 : 0
    s += (r.pTarget - y) ** 2; n++
    const b = buckets[Math.min(4, Math.floor(r.pTarget * 5))]
    b.p += r.pTarget; b.y += y; b.n++
  }
  return { n, brier: +(s / n).toFixed(3), reliability: buckets.filter(b => b.n).map(b => ({ mean_p: +(b.p / b.n).toFixed(2), observed: +(b.y / b.n).toFixed(2), n: b.n })) }
}

const res = {
  note: 'Synthetic learners (latent truth known to the generator); real essays scored by the real model. A check that the forecast and calibration machinery behave, not evidence of real-world accuracy.',
  learners_with_official: synth.officials.length,
  ai_writing_minus_latent: { mean: +(aiVsLatent.reduce((a, b) => a + b, 0) / aiVsLatent.length).toFixed(3), n: aiVsLatent.length },
  calibration_learned_on_half_0: cal,
  half_1_without_calibration: evaluate({}, 1),
  half_1_with_calibration: evaluate(cal, 1),
  p_target_4_weeks_ahead_without_calibration: brier({}),
  p_target_4_weeks_ahead_with_calibration: brier(cal),
}
writeFileSync(dst, JSON.stringify(res, null, 2))
console.log(JSON.stringify(res, null, 2))
