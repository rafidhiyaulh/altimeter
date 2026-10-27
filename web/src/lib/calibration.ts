import 'server-only'
import { fitCalibration, type Calibration } from './readiness'

export type CalPair = { student_id: number; skill: string; source: string; observed: number; official: number }

// Fit the offset per skill:source on learners with an even id and measure on the odd ones (and the
// reverse), so the "after" numbers are never measured on the pairs that produced the correction.
// The saved correction is then fitted on all pairs.
export function buildCalibration(pairs: CalPair[]) {
  const keys = [...new Set(pairs.map(p => `${p.skill}:${p.source}`))].sort()
  const entries: Calibration = {}
  const evaluation: Record<string, { n: number; bias_before: number; mae_before: number; bias_after: number; mae_after: number; a: number }> = {}
  for (const k of keys) {
    const ps = pairs.filter(p => `${p.skill}:${p.source}` === k)
    const all = fitCalibration(ps.map(p => ({ x: p.observed, y: p.official })))
    if (!all) continue
    entries[k as keyof Calibration] = { a: round(all.a), b: 1, n: all.n }
    let bb = 0, mb = 0, ba = 0, ma = 0, cnt = 0
    for (const half of [0, 1]) {
      const fit = fitCalibration(ps.filter(p => p.student_id % 2 !== half).map(p => ({ x: p.observed, y: p.official })))
      const a = fit?.a ?? 0
      for (const p of ps.filter(p => p.student_id % 2 === half)) {
        const before = p.observed - p.official
        const after = p.observed + a - p.official
        bb += before; mb += Math.abs(before); ba += after; ma += Math.abs(after); cnt++
      }
    }
    evaluation[k] = { n: cnt, bias_before: round(bb / cnt), mae_before: round(mb / cnt), bias_after: round(ba / cnt), mae_after: round(ma / cnt), a: round(all.a) }
  }
  return { entries, evaluation }
}

const round = (x: number) => Math.round(x * 1000) / 1000
