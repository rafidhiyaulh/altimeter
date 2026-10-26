import { describe, expect, it } from 'vitest'
import { agreement, bootstrap, qwk } from '../agreement'
import { fitCalibration, forecast, ieltsRound, type Prior } from '../readiness'
import prior from '../readiness-prior.json'

describe('agreement', () => {
  it('perfect agreement has QWK 1 and zero error', () => {
    const p = [5, 5.5, 6, 6.5, 7].map(x => ({ ai: x, ref: x }))
    const a = agreement(p)
    expect(a.qwk).toBeCloseTo(1)
    expect(a.mae).toBe(0)
    expect(a.withinHalf).toBe(1)
  })
  it('a constant +0.5 shift is visible as bias, still within half a band', () => {
    const p = [5, 5.5, 6, 6.5, 7].map(x => ({ ai: x + 0.5, ref: x }))
    const a = agreement(p)
    expect(a.bias).toBeCloseTo(0.5)
    expect(a.withinHalf).toBe(1)
    expect(a.exact).toBe(0)
  })
  it('QWK of reversed ratings is negative', () => {
    expect(qwk([5, 6, 7].map((x, i) => ({ ai: x, ref: [7, 6, 5][i] })))).toBeLessThan(0)
  })
  it('bootstrap intervals contain the point estimate', () => {
    const p = Array.from({ length: 60 }, (_, i) => ({ ai: 5 + (i % 5) * 0.5, ref: 5 + ((i + (i % 3 === 0 ? 1 : 0)) % 5) * 0.5 }))
    const a = agreement(p)
    const ci = bootstrap(p)!
    expect(ci.mae[0]).toBeLessThanOrEqual(a.mae)
    expect(ci.mae[1]).toBeGreaterThanOrEqual(a.mae)
  })
})

describe('readiness', () => {
  const P = prior as unknown as Prior
  const W = 7 * 86400000
  const now = Date.UTC(2026, 9, 26)
  const obs = (skill: 'reading' | 'listening' | 'writing' | 'speaking', bands: number[]) =>
    bands.map((b, i) => ({ skill, source: 'practice' as const, band: b, at: now - (bands.length - i) * W }))

  it('a learner far above target is on track; far below is at risk', () => {
    const high = [...obs('reading', [7.5, 7.5, 8]), ...obs('listening', [8, 8, 8]), ...obs('writing', [7, 7, 7.5]), ...obs('speaking', [7, 7.5, 7.5])]
    const low = [...obs('reading', [4.5, 4.5, 5]), ...obs('listening', [5, 5, 5]), ...obs('writing', [4, 4, 4.5]), ...obs('speaking', [4.5, 4.5, 5])]
    const target = { overall: 6.5, minSkill: 6, deadline: now + 6 * W }
    expect(forecast(high, target, P, {}, now).status).toBe('on_track')
    const r = forecast(low, target, P, {}, now)
    expect(r.status).toBe('at_risk')
    expect(r.binding).toBe('writing')
  })
  it('is deterministic for the same learner', () => {
    const o = [...obs('reading', [6, 6]), ...obs('listening', [6, 6.5]), ...obs('writing', [5.5, 6]), ...obs('speaking', [6, 6])]
    const t = { overall: 6.5, minSkill: 6, deadline: now + 8 * W }
    expect(forecast(o, t, P, {}, now, 9).pTarget).toBe(forecast(o, t, P, {}, now, 9).pTarget)
  })
  it('a missing skill means not enough data', () => {
    const o = [...obs('reading', [6, 6]), ...obs('listening', [6, 6.5]), ...obs('writing', [5.5, 6])]
    expect(forecast(o, { overall: 6, minSkill: 5.5, deadline: now + W }, P, {}, now).status).toBe('insufficient_data')
  })
  it('calibration is an offset shrunk toward zero and needs 15 pairs', () => {
    expect(fitCalibration(Array.from({ length: 10 }, () => ({ x: 6.5, y: 6 })))).toBeNull()
    const c = fitCalibration(Array.from({ length: 30 }, () => ({ x: 6.5, y: 6 })))!
    expect(c.a).toBeCloseTo(-0.5 * 30 / 40)
    expect(c.b).toBe(1)
  })
  it('rounds like IELTS', () => {
    expect(ieltsRound(6.125)).toBe(6)
    expect(ieltsRound(6.25)).toBe(6.5)
  })
})
