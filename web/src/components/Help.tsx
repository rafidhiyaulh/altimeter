'use client'

import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Info } from 'lucide-react'
import { GLOSSARY } from '@/lib/glossary'
import { useT } from './Lang'

export type TermKey = keyof typeof GLOSSARY
const pair = (k: TermKey) => GLOSSARY[k] as readonly [string, string]

function Pop({ anchor, text }: { anchor: DOMRect; text: string }) {
  const left = Math.min(Math.max(12, anchor.left), window.innerWidth - 292)
  const below = anchor.bottom + 8 + 120 < window.innerHeight
  return createPortal(
    <div role="tooltip" className="pop" style={{ left, top: below ? anchor.bottom + 8 : undefined, bottom: below ? undefined : window.innerHeight - anchor.top + 8 }}>{text}</div>,
    document.body,
  )
}

function useHover() {
  const ref = useRef<HTMLSpanElement>(null)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const on = () => ref.current && setRect(ref.current.getBoundingClientRect())
  const off = () => setRect(null)
  return { ref, rect, handlers: { onMouseEnter: on, onMouseLeave: off, onFocus: on, onBlur: off } }
}

export function Term({ k, children }: { k: TermKey; children: React.ReactNode }) {
  const { ref, rect, handlers } = useHover()
  const { t } = useT()
  return (
    <span ref={ref} className="term" tabIndex={0} {...handlers}>
      {children}
      {rect && <Pop anchor={rect} text={t(...pair(k))} />}
    </span>
  )
}

export function InfoTip({ text, k }: { text?: string; k?: TermKey }) {
  const { ref, rect, handlers } = useHover()
  const { t } = useT()
  const body = text ?? (k ? t(...pair(k)) : '')
  return (
    <span ref={ref} className="info-tip" tabIndex={0} aria-label={body} {...handlers}>
      <Info size={12} />
      {rect && <Pop anchor={rect} text={body} />}
    </span>
  )
}
