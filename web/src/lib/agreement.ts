// Agreement between two raters on half-band scores (AI vs teacher, practice vs official), with a
// percentile bootstrap so small samples show how unsure the numbers are. Deterministic (seeded).

export type Pair = { ai: number; ref: number }
export type Agreement = { n: number; exact: number; withinHalf: number; mae: number; bias: number; qwk: number }

export function qwk(pairs: Pair[]): number {
  if (pairs.length < 2) return Number.NaN
  const cls = (x: number) => Math.round(x * 2)
  const vals = pairs.flatMap(p => [cls(p.ai), cls(p.ref)])
  const lo = Math.min(...vals)
  const k = Math.max(...vals) - lo + 1
  if (k <= 1) return 1
  const O = Array.from({ length: k }, () => new Array(k).fill(0))
  const ha = new Array(k).fill(0)
  const hb = new Array(k).fill(0)
  for (const p of pairs) {
    const a = cls(p.ai) - lo
    const b = cls(p.ref) - lo
    O[a][b]++
    ha[a]++
    hb[b]++
  }
  const n = pairs.length
  let num = 0
  let den = 0
  for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) {
    const w = ((i - j) * (i - j)) / ((k - 1) * (k - 1))
    num += w * O[i][j]
    den += w * (ha[i] * hb[j]) / n
  }
  return den === 0 ? 1 : 1 - num / den
}

export function agreement(pairs: Pair[]): Agreement {
  const n = pairs.length
  if (n === 0) return { n: 0, exact: Number.NaN, withinHalf: Number.NaN, mae: Number.NaN, bias: Number.NaN, qwk: Number.NaN }
  let exact = 0, within = 0, abs = 0, signed = 0
  for (const p of pairs) {
    const d = p.ai - p.ref
    if (Math.abs(d) < 1e-9) exact++
    if (Math.abs(d) <= 0.5 + 1e-9) within++
    abs += Math.abs(d)
    signed += d
  }
  return { n, exact: exact / n, withinHalf: within / n, mae: abs / n, bias: signed / n, qwk: qwk(pairs) }
}

function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// 95% percentile interval for each metric from B resamples.
export function bootstrap(pairs: Pair[], B = 400, seed = 7) {
  const draw = rng(seed)
  const keys = ['exact', 'withinHalf', 'mae', 'bias', 'qwk'] as const
  const acc: Record<(typeof keys)[number], number[]> = { exact: [], withinHalf: [], mae: [], bias: [], qwk: [] }
  if (pairs.length < 5) return null
  for (let b = 0; b < B; b++) {
    const s = Array.from({ length: pairs.length }, () => pairs[Math.floor(draw() * pairs.length)])
    const a = agreement(s)
    for (const k of keys) if (Number.isFinite(a[k])) acc[k].push(a[k])
  }
  const ci = (xs: number[]) => {
    const v = [...xs].sort((x, y) => x - y)
    return [v[Math.floor(v.length * 0.025)], v[Math.min(v.length - 1, Math.floor(v.length * 0.975))]] as [number, number]
  }
  return Object.fromEntries(keys.map(k => [k, ci(acc[k])])) as Record<(typeof keys)[number], [number, number]>
}

// Cross-tab of AI vs reference half-bands, for the agreement matrix.
export function crossTab(pairs: Pair[]) {
  const bands = [...new Set(pairs.flatMap(p => [p.ai, p.ref]))].sort((a, b) => a - b)
  const m = new Map<string, number>()
  for (const p of pairs) m.set(`${p.ai}|${p.ref}`, (m.get(`${p.ai}|${p.ref}`) ?? 0) + 1)
  return { bands, get: (ai: number, ref: number) => m.get(`${ai}|${ref}`) ?? 0 }
}
