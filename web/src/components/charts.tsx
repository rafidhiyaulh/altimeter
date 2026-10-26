import type { ReactNode } from 'react'
import { tr } from '@/lib/i18n'
import { band, date, pct, shortDate } from '@/lib/format'

// Hand-built SVG charts on the theme tokens. Rules: one axis, thin marks, recessive grid, text in ink
// tokens (never the series colour), and every mark carries a <title> so hovering shows its value.

// ------------------------------------------------------------------ status bar (part of a whole)
export type StatusCounts = { on_track: number; watch: number; at_risk: number; insufficient_data: number }
const STATUS_FILL = { on_track: 'var(--chart-good)', watch: 'var(--chart-warn)', at_risk: 'var(--chart-bad)', insufficient_data: 'var(--chart-neutral)' }

export function StatusBar({ c, height = 10, legend = true }: { c: StatusCounts; height?: number; legend?: boolean }) {
  const order = ['on_track', 'watch', 'at_risk', 'insufficient_data'] as const
  const total = order.reduce((a, k) => a + (c[k] ?? 0), 0) || 1
  const label = {
    on_track: tr('Sesuai jalur', 'On track'), watch: tr('Perlu dipantau', 'Watch'),
    at_risk: tr('Berisiko', 'At risk'), insufficient_data: tr('Data belum cukup', 'Not enough data'),
  }
  return (
    <div>
      <div className="sbar" style={{ height }} role="img" aria-label={order.map(k => `${label[k]} ${c[k] ?? 0}`).join(', ')}>
        {order.filter(k => (c[k] ?? 0) > 0).map(k => (
          <span key={k} style={{ width: `${((c[k] ?? 0) / total) * 100}%`, background: STATUS_FILL[k] }} title={`${label[k]}: ${c[k]} (${pct((c[k] ?? 0) / total)})`} />
        ))}
      </div>
      {legend && (
        <div className="legend" style={{ padding: '8px 0 0' }}>
          {order.map(k => (
            <span key={k} className="k"><span className="sw" style={{ background: STATUS_FILL[k], width: 9, height: 9 }} />{label[k]} <b className="num">{c[k] ?? 0}</b></span>
          ))}
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ skill trajectory (small multiple)
export type TrajPoint = { at: number; band: number; source: string }
export type TrajLevel = { at: number; level: number; sd: number }

export function Trajectory({ title, points, path, projection, minSkill, start, end, now, officials = [], footer }: {
  title: ReactNode
  points: TrajPoint[]
  path: TrajLevel[]
  projection: { from: TrajLevel; to: TrajLevel } | null
  minSkill: number
  start: number
  end: number
  now: number
  officials?: { at: number; band: number }[]
  footer?: ReactNode
}) {
  const W = 320, H = 150, L = 30, R = 10, T = 10, B = 22
  const ys = [...points.map(p => p.band), ...path.map(p => p.level), minSkill, ...(projection ? [projection.to.level] : []), ...officials.map(o => o.band)]
  const lo = Math.max(1, Math.floor(Math.min(...ys) - 0.75))
  const hi = Math.min(9, Math.ceil(Math.max(...ys) + 0.75))
  const x = (t: number) => L + ((t - start) / (end - start)) * (W - L - R)
  const y = (b: number) => T + (1 - (b - lo) / (hi - lo)) * (H - T - B)
  const ticks: number[] = []
  for (let b = lo; b <= hi; b += 1) ticks.push(b)
  const band1 = path.length > 1
    ? `M${path.map(p => `${x(p.at)},${y(p.level + p.sd)}`).join('L')}L${[...path].reverse().map(p => `${x(p.at)},${y(p.level - p.sd)}`).join('L')}Z`
    : ''
  const line = path.length > 1 ? `M${path.map(p => `${x(p.at)},${y(p.level)}`).join('L')}` : ''
  return (
    <figure className="traj">
      <figcaption className="traj-title">{title}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={typeof title === 'string' ? title : undefined}>
        {ticks.map(b => (
          <g key={b}>
            <line x1={L} x2={W - R} y1={y(b)} y2={y(b)} stroke="var(--chart-grid)" />
            <text x={L - 6} y={y(b) + 3.5} textAnchor="end" fontSize="9.5" fill="var(--muted-foreground)">{b}</text>
          </g>
        ))}
        <line x1={L} x2={W - R} y1={y(minSkill)} y2={y(minSkill)} stroke="var(--muted-foreground)" strokeDasharray="3 3" />
        <text x={L + 3} y={y(minSkill) - 4} fontSize="9" fill="var(--muted-foreground)">{`min ${band(minSkill)}`}</text>
        <line x1={x(now)} x2={x(now)} y1={T} y2={H - B} stroke="var(--rule2)" />
        <text x={x(now)} y={H - 8} textAnchor="middle" fontSize="9" fill="var(--muted-foreground)">{tr('hari ini', 'today')}</text>
        <text x={L} y={H - 8} fontSize="9" fill="var(--muted-foreground)">{shortDate(start)}</text>
        <text x={W - R} y={H - 8} textAnchor="end" fontSize="9" fill="var(--muted-foreground)">{shortDate(end)}</text>
        {band1 && <path d={band1} fill="var(--brand)" opacity=".12" />}
        {projection && (
          <>
            <path d={`M${x(projection.from.at)},${y(projection.from.level + projection.from.sd)}L${x(projection.to.at)},${y(projection.to.level + projection.to.sd)}L${x(projection.to.at)},${y(projection.to.level - projection.to.sd)}L${x(projection.from.at)},${y(projection.from.level - projection.from.sd)}Z`}
              fill="var(--brand)" opacity=".07" />
            <line x1={x(projection.from.at)} y1={y(projection.from.level)} x2={x(projection.to.at)} y2={y(projection.to.level)}
              stroke="var(--brand)" strokeWidth="2" strokeDasharray="4 3" />
            <circle cx={x(projection.to.at)} cy={y(projection.to.level)} r="4" fill="var(--panel)" stroke="var(--brand)" strokeWidth="2">
              <title>{`${tr('Perkiraan saat deadline', 'Forecast at deadline')}: ${band(projection.to.level)} ± ${band(projection.to.sd)}`}</title>
            </circle>
          </>
        )}
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={x(p.at)} cy={y(p.band)} r={p.source === 'mock' ? 3.2 : 2.6} fill="var(--ink2)" opacity={p.source === 'mock' ? 0.75 : 0.4} />
            <circle cx={x(p.at)} cy={y(p.band)} r="7" fill="transparent"><title>{`${date(p.at)} · ${sourceLabel(p.source)} · ${band(p.band)}`}</title></circle>
          </g>
        ))}
        {line && <path d={line} fill="none" stroke="var(--brand)" strokeWidth="2" strokeLinejoin="round" />}
        {officials.map((o, i) => (
          <g key={`o${i}`}>
            <rect x={x(o.at) - 4.5} y={y(o.band) - 4.5} width="9" height="9" fill="var(--ink)" stroke="var(--panel)" strokeWidth="2" transform={`rotate(45 ${x(o.at)} ${y(o.band)})`} />
            <circle cx={x(o.at)} cy={y(o.band)} r="8" fill="transparent"><title>{`${tr('Tes resmi', 'Official test')} ${date(o.at)} · ${band(o.band)}`}</title></circle>
          </g>
        ))}
      </svg>
      {footer && <div className="traj-foot">{footer}</div>}
    </figure>
  )
}

export function TrajectoryLegend() {
  return (
    <div className="legend" style={{ padding: '4px 0 0' }}>
      <span className="k"><span className="sw" style={{ background: 'var(--ink2)', opacity: 0.5, width: 7, height: 7 }} />{tr('Skor latihan / AI', 'Practice / AI score')}</span>
      <span className="k"><span style={{ width: 16, height: 2, background: 'var(--brand)', display: 'inline-block' }} />{tr('Perkiraan level (± 1 sd)', 'Estimated level (± 1 sd)')}</span>
      <span className="k"><span style={{ width: 16, height: 0, borderTop: '2px dashed var(--brand)', display: 'inline-block' }} />{tr('Proyeksi ke deadline', 'Projection to deadline')}</span>
      <span className="k"><span style={{ width: 8, height: 8, background: 'var(--ink)', transform: 'rotate(45deg)', display: 'inline-block' }} />{tr('Tes resmi', 'Official test')}</span>
    </div>
  )
}

export const sourceLabel = (s: string) => ({
  practice: tr('Latihan', 'Practice'), mock: tr('Mock test', 'Mock test'), ai_writing: tr('AI writing', 'AI writing'),
  ai_speaking: tr('AI speaking', 'AI speaking'), official: tr('Resmi', 'Official'),
} as Record<string, string>)[s] ?? s

// ------------------------------------------------------------------ reliability (predicted vs observed)
export function Reliability({ rows }: { rows: { mean_p: number; observed: number; n: number }[] }) {
  const W = 260, H = 200, L = 32, R = 10, T = 10, B = 28
  const x = (v: number) => L + v * (W - L - R)
  const y = (v: number) => T + (1 - v) * (H - T - B)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: 320 }} role="img" aria-label={tr('Kalibrasi peluang', 'Probability calibration')}>
      {[0, 0.25, 0.5, 0.75, 1].map(v => (
        <g key={v}>
          <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--chart-grid)" />
          <text x={L - 6} y={y(v) + 3.5} textAnchor="end" fontSize="9.5" fill="var(--muted-foreground)">{pct(v)}</text>
          <text x={x(v)} y={H - 12} textAnchor="middle" fontSize="9.5" fill="var(--muted-foreground)">{pct(v)}</text>
        </g>
      ))}
      <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} stroke="var(--rule2)" strokeDasharray="3 3" />
      {rows.map((r, i) => (
        <g key={i}>
          <circle cx={x(r.mean_p)} cy={y(r.observed)} r={3 + Math.sqrt(r.n)} fill="var(--brand)" opacity=".8" stroke="var(--panel)" strokeWidth="2" />
          <circle cx={x(r.mean_p)} cy={y(r.observed)} r={10 + Math.sqrt(r.n)} fill="transparent">
            <title>{`${tr('Peluang rata-rata', 'Mean predicted')} ${pct(r.mean_p)} · ${tr('terjadi', 'observed')} ${pct(r.observed)} · n=${r.n}`}</title>
          </circle>
        </g>
      ))}
      <text x={(L + W - R) / 2} y={H - 1} textAnchor="middle" fontSize="9.5" fill="var(--muted-foreground)">{tr('peluang yang diprediksi', 'predicted chance')}</text>
    </svg>
  )
}

// ------------------------------------------------------------------ agreement matrix (sequential blue)
export function Matrix({ rows, cols, get, rowLabel, colLabel }: {
  rows: number[]; cols: number[]; get: (r: number, c: number) => number; rowLabel: string; colLabel: string
}) {
  const max = Math.max(1, ...rows.flatMap(r => cols.map(c => get(r, c))))
  const step = (v: number) => (v === 0 ? 'transparent' : `var(--seq-${Math.min(4, Math.floor((v / max) * 4.999))})`)
  const ink = (v: number) => (v / max > 0.55 ? '#FFFFFF' : 'var(--ink)')
  return (
    <div className="table-wrap">
      <table className="matrix">
        <thead>
          <tr><th className="corner">{rowLabel} ↓ · {colLabel} →</th>{cols.map(c => <th key={c} className="num">{band(c)}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r}>
              <th className="num">{band(r)}</th>
              {cols.map(c => {
                const v = get(r, c)
                return <td key={c} className={r === c ? 'diag' : undefined} style={{ background: step(v), color: ink(v) }} title={`${rowLabel} ${band(r)} · ${colLabel} ${band(c)}: ${v}`}>{v || ''}</td>
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ------------------------------------------------------------------ horizontal bars with a reference mark
export function GapBars({ rows }: { rows: { label: string; value: number; note: ReactNode; title?: string }[] }) {
  const max = Math.max(0.0001, ...rows.map(r => r.value))
  return (
    <ul className="bars">
      {rows.map(r => (
        <li key={r.label} title={r.title}>
          <div className="row1"><span>{r.label}</span><span className="muted">{r.note}</span></div>
          <div className="track"><div className="fill" style={{ width: `${(r.value / max) * 100}%` }} /></div>
        </li>
      ))}
    </ul>
  )
}
