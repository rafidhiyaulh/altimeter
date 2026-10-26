import Link from 'next/link'
import type { ReactNode } from 'react'
import { InfoTip, type TermKey } from './Help'
import { tr } from '@/lib/i18n'
import { band, pct } from '@/lib/format'

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ')
}

export type Tone = 'good' | 'warn' | 'serious' | 'bad' | 'neutral' | 'low' | 'brand'

export function Badge({ tone = 'neutral', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return <span className={`badge b-${tone}`} title={title}>{children}</span>
}

export function PageHead({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1 className="page-title">{title}</h1>
        {sub && <p className="page-sub">{sub}</p>}
      </div>
      {children && <div className="toolbar">{children}</div>}
    </div>
  )
}

export function Card({ title, sub, right, children, pad = true, className, id }: {
  title?: ReactNode; sub?: ReactNode; right?: ReactNode; children: ReactNode; pad?: boolean; className?: string; id?: string
}) {
  return (
    <section className={cx('card', className)} id={id}>
      {(title || right) && (
        <div className="card-head">
          <div>
            {title && <h2 className="card-title">{title}</h2>}
            {sub && <div className="card-sub">{sub}</div>}
          </div>
          {right}
        </div>
      )}
      <div className={pad ? 'card-pad' : undefined} style={!pad && title ? { marginTop: 12 } : undefined}>{children}</div>
    </section>
  )
}

export function Kpi({ label, value, sub, tone, keyColor, term, help, href, on }: {
  label: string; value: ReactNode; sub?: ReactNode; tone?: 'bad'; keyColor?: string; term?: TermKey; help?: string; href?: string; on?: boolean
}) {
  const body = (
    <>
      <div className="label">
        {keyColor && <span className="key" style={{ background: keyColor }} aria-hidden />}
        <span>{label}</span>{(term || help) && <InfoTip k={term} text={help} />}
      </div>
      <div className={cx('value', tone)}>{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </>
  )
  return href
    ? <Link href={href} className={cx('kpi', on && 'on')} aria-current={on ? 'page' : undefined}>{body}</Link>
    : <div className="kpi">{body}</div>
}

export function Facts({ items, tight }: { items: { label: string; value: ReactNode }[]; tight?: boolean }) {
  return (
    <div className={cx('facts', tight && 'tight')}>
      {items.map(i => (
        <div key={i.label}>
          <div className="facts-l">{i.label}</div>
          <div className="facts-v">{i.value}</div>
        </div>
      ))}
    </div>
  )
}

export function Seg({ items, active }: { items: { key: string; label: ReactNode; href: string; count?: number }[]; active: string }) {
  return (
    <nav className="seg" aria-label={tr('Pilihan tampilan', 'View options')}>
      {items.map(t => (
        <Link key={t.key} href={t.href} className={t.key === active ? 'on' : undefined} aria-current={t.key === active ? 'page' : undefined}>
          {t.label}{t.count != null && <span className="n">{t.count.toLocaleString()}</span>}
        </Link>
      ))}
    </nav>
  )
}

const DOT: Record<Tone, string> = {
  good: 'var(--chart-good)', warn: 'var(--chart-warn)', serious: 'var(--chart-serious)', bad: 'var(--chart-bad)',
  neutral: 'var(--chart-neutral)', low: 'var(--low)', brand: 'var(--brand)',
}

export function Status({ tone, children, title }: { tone: Tone; children: ReactNode; title?: string }) {
  return <span className="status" title={title}><span className="dot" style={{ background: DOT[tone] }} aria-hidden />{children}</span>
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>
}

// ------------------------------------------------------------------ readiness vocabulary
export type ReadyStatus = 'on_track' | 'watch' | 'at_risk' | 'insufficient_data'
export const STATUS_TONE: Record<ReadyStatus, Tone> = { on_track: 'good', watch: 'warn', at_risk: 'bad', insufficient_data: 'neutral' }
export const statusLabel = (s: string | null | undefined) => ({
  on_track: tr('Sesuai jalur', 'On track'),
  watch: tr('Perlu dipantau', 'Watch'),
  at_risk: tr('Berisiko', 'At risk'),
  insufficient_data: tr('Data belum cukup', 'Not enough data'),
} as Record<string, string>)[s ?? 'insufficient_data'] ?? s ?? '-'

export function ReadyBadge({ status }: { status: string | null }) {
  const s = (status ?? 'insufficient_data') as ReadyStatus
  return <Status tone={STATUS_TONE[s] ?? 'neutral'}>{statusLabel(s)}</Status>
}

export const SKILL_LABEL = (s: string) => ({
  reading: tr('Reading', 'Reading'), listening: tr('Listening', 'Listening'), writing: tr('Writing', 'Writing'), speaking: tr('Speaking', 'Speaking'),
} as Record<string, string>)[s] ?? s

export const CRIT_LABEL = (c: string) => ({
  TR: tr('Task Response', 'Task Response'), CC: tr('Coherence & Cohesion', 'Coherence & Cohesion'),
  LR: tr('Lexical Resource', 'Lexical Resource'), GRA: tr('Grammatical Range & Accuracy', 'Grammatical Range & Accuracy'),
} as Record<string, string>)[c] ?? c

// A probability as a small bar + number; neutral ink, the number carries the meaning.
export function Prob({ p }: { p: number | null }) {
  if (p == null || Number.isNaN(p)) return <span className="muted">-</span>
  const v = Math.max(0, Math.min(1, p))
  return (
    <span className="score" title={tr(`Peluang ${pct(v)}`, `Chance ${pct(v)}`)}>
      <span className="track"><span className="fill" style={{ width: `${v * 100}%`, background: 'var(--ink2)', display: 'block' }} /></span>
      <span className="n" style={{ width: 34 }}>{pct(v)}</span>
    </span>
  )
}

export function Band({ v, sub }: { v: number | string | null | undefined; sub?: ReactNode }) {
  return <span className="band-v">{band(v)}{sub && <span className="muted small"> {sub}</span>}</span>
}
