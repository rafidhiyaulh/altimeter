// Tree evaluator for the exported LightGBM writing scorer (ml/altimeter_ml/train_writing.py).
// Reproduces the Python raw scores (parity test in __tests__), and explains a prediction by tracing
// each tree's path (Saabas): the change in node value at every split is credited to that split's feature,
// so contributions + base sum exactly to the prediction.

import { extractFeatures, type FeatureVector, type Lexicon } from './features.ts'

export const CRITERIA = ['TR', 'CC', 'LR', 'GRA'] as const
export type Criterion = (typeof CRITERIA)[number]

type Tree = { f: number[]; t: number[]; l: number[]; r: number[]; v: number[]; d: number[]; leaf: number[] }
export type WritingModel = {
  version: string
  features: string[]
  conformal: { q80: number; q90: number }
  criteria: Record<Criterion, { trees: Tree[] }>
}

function treeValue(tree: Tree, x: number[]): number {
  if (tree.f.length === 0) return tree.leaf[0]
  let i = 0
  for (;;) {
    const v = x[tree.f[i]]
    const next = Number.isNaN(v) ? (tree.d[i] ? tree.l[i] : tree.r[i]) : v <= tree.t[i] ? tree.l[i] : tree.r[i]
    if (next < 0) return tree.leaf[~next]
    i = next
  }
}

// Path attribution for one tree: returns base (root value) and adds per-feature deltas into acc.
function treePath(tree: Tree, x: number[], acc: Float64Array): number {
  if (tree.f.length === 0) return tree.leaf[0]
  let i = 0
  const base = tree.v[0]
  let prev = base
  for (;;) {
    const v = x[tree.f[i]]
    const next = Number.isNaN(v) ? (tree.d[i] ? tree.l[i] : tree.r[i]) : v <= tree.t[i] ? tree.l[i] : tree.r[i]
    const val = next < 0 ? tree.leaf[~next] : tree.v[next]
    acc[tree.f[i]] += val - prev
    prev = val
    if (next < 0) return base
    i = next
  }
}

export function vectorOf(model: WritingModel, f: FeatureVector): number[] {
  return model.features.map(k => f[k] ?? Number.NaN)
}

export function rawScore(model: WritingModel, c: Criterion, x: number[]): number {
  let s = 0
  for (const t of model.criteria[c].trees) s += treeValue(t, x)
  return s
}

export function explain(model: WritingModel, c: Criterion, x: number[]) {
  const acc = new Float64Array(model.features.length)
  let base = 0
  for (const t of model.criteria[c].trees) base += treePath(t, x, acc)
  return { base, contributions: model.features.map((name, i) => ({ name, value: x[i], delta: acc[i] })) }
}

// IELTS: criterion and overall bands are reported in half bands; .25 and .75 round up.
export const ieltsRound = (x: number) => Math.floor(x * 2 + 0.5) / 2
export const clampBand = (x: number) => Math.min(9, Math.max(1, x))

export type WritingScore = {
  version: string
  raw: Record<Criterion, number>
  bands: Record<Criterion, number>
  overallRaw: number
  overall: number
  interval80: [number, number]
  interval90: [number, number]
  flags: string[]
  drivers: { criterion: Criterion; name: string; value: number; delta: number }[]
  features: FeatureVector
}

export function scoreEssay(model: WritingModel, lex: Lexicon, prompt: string, essay: string): WritingScore {
  const features = extractFeatures(prompt, essay, lex)
  const x = vectorOf(model, features)
  const raw = {} as Record<Criterion, number>
  const bands = {} as Record<Criterion, number>
  const drivers: WritingScore['drivers'] = []
  for (const c of CRITERIA) {
    raw[c] = rawScore(model, c, x)
    bands[c] = clampBand(ieltsRound(raw[c]))
    const top = explain(model, c, x).contributions.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 3)
    for (const t of top) drivers.push({ criterion: c, ...t })
  }
  const overallRaw = CRITERIA.reduce((a, c) => a + raw[c], 0) / CRITERIA.length
  const overall = clampBand(ieltsRound(overallRaw))
  const q80 = model.conformal.q80
  const q90 = model.conformal.q90
  const flags: string[] = []
  // Signals that the number deserves a human look before anyone acts on it.
  if (features.n_words < 150) flags.push('too_short')
  if (features.prompt_coverage < 0.15) flags.push('off_topic')
  if (features.oov_ratio > 0.12) flags.push('unusual_vocabulary')
  if (features.stock_phrases >= 4) flags.push('template_heavy')
  const frac = overallRaw * 2 - Math.floor(overallRaw * 2)
  if (Math.abs(frac - 0.5) < 0.08) flags.push('borderline')
  return {
    version: model.version,
    raw, bands, overallRaw, overall,
    interval80: [clampBand(ieltsRound(overallRaw - q80)), clampBand(ieltsRound(overallRaw + q80))],
    interval90: [clampBand(ieltsRound(overallRaw - q90)), clampBand(ieltsRound(overallRaw + q90))],
    flags,
    drivers,
    features,
  }
}
