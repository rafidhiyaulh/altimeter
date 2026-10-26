'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useT } from './Lang'

type Item = { criterion: string; kind: 'strength' | 'improve'; text: string; quote: string | null; suggestion: string | null }
export type Fb = { summary: string; items: Item[]; next: string[] }

// Polls until the worker has scored the essay, then refreshes the page.
export function StatusPoller({ id }: { id: string }) {
  const router = useRouter()
  const { t } = useT()
  const [secs, setSecs] = useState(0)
  useEffect(() => {
    let stop = false
    const started = Date.now()
    const tick = async () => {
      if (stop) return
      setSecs(Math.round((Date.now() - started) / 1000))
      const r = await fetch(`/api/essays/${id}/status`, { cache: 'no-store' }).then(x => x.json()).catch(() => null)
      if (r?.status && r.status !== 'queued') { router.refresh(); return }
      setTimeout(tick, 1500)
    }
    tick()
    return () => { stop = true }
  }, [id, router])
  return <p className="note info" role="status">{t('Sedang dinilai...', 'Scoring...')} {secs}s</p>
}

const CRIT: Record<string, string> = { TR: 'Task Response', CC: 'Coherence & Cohesion', LR: 'Lexical Resource', GRA: 'Grammatical Range & Accuracy' }

export function FeedbackView({ fb }: { fb: Fb }) {
  const { t } = useT()
  const groups = ['TR', 'CC', 'LR', 'GRA'].map(c => ({ c, items: fb.items.filter(i => i.criterion === c) })).filter(g => g.items.length)
  return (
    <div className="stack">
      {fb.summary && <p>{fb.summary}</p>}
      {groups.map(g => (
        <div key={g.c}>
          <div className="subhead">{CRIT[g.c]}</div>
          {g.items.map((it, i) => (
            <div key={i} className="fb-item">
              <span className={`badge ${it.kind === 'strength' ? 'b-good' : 'b-warn'}`}>{it.kind === 'strength' ? t('kekuatan', 'strength') : t('perbaiki', 'improve')}</span>{' '}
              {it.text}
              {it.quote && <q>{it.quote}</q>}
              {it.suggestion && <div className="sug small">→ {it.suggestion}</div>}
            </div>
          ))}
        </div>
      ))}
      {fb.next?.length > 0 && <div><div className="subhead">{t('Berikutnya', 'Next')}</div><ul style={{ listStyle: 'disc', paddingLeft: 18 }}>{fb.next.map(x => <li key={x}>{x}</li>)}</ul></div>}
    </div>
  )
}

export function FeedbackPanel({ id, initial, aiAllowed }: { id: string; initial: { fb: Fb; source: string; lang: string; dropped: number } | null; aiAllowed: boolean }) {
  const { t, lang } = useT()
  const router = useRouter()
  const [pending, start] = useTransition()
  const [cur, setCur] = useState(initial)
  const [err, setErr] = useState<string | null>(null)
  const gen = () => start(async () => {
    setErr(null)
    const res = await fetch(`/api/essays/${id}/feedback`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lang }) })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) { setErr(data.detail ?? data.title ?? 'Failed'); return }
    setCur({ fb: data.feedback, source: data.source, lang, dropped: data.dropped })
    router.refresh()
  })
  return (
    <div className="stack">
      <div className="row between">
        <span className="muted small">
          {cur ? (cur.source === 'llm'
            ? t(`Ditulis LLM, lolos cek kutipan${cur.dropped ? `; ${cur.dropped} butir dibuang` : ''}`, `Written by the LLM, quote-checked${cur.dropped ? `; ${cur.dropped} items dropped` : ''}`)
            : t('Berbasis aturan (tanpa LLM)', 'Rule-based (no LLM)')) : t('Belum ada feedback.', 'No feedback yet.')}
          {!aiAllowed && <> · {t('tanpa izin AI: esai tidak dikirim ke LLM', 'no AI consent: the essay is never sent to an LLM')}</>}
        </span>
        <button className="btn btn-sm btn-primary" disabled={pending} onClick={gen}>
          {pending ? t('Menyusun...', 'Drafting...') : cur ? t('Susun ulang', 'Redraft') : t('Susun feedback', 'Draft feedback')} ({lang.toUpperCase()})
        </button>
      </div>
      {err && <p className="alert">{err}</p>}
      {cur && <FeedbackView fb={cur.fb} />}
    </div>
  )
}

export function ReviewForm({ id, ai }: { id: string; ai: { tr: number; cc: number; lr: number; gra: number } | null }) {
  const { t } = useT()
  const router = useRouter()
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const bands = Array.from({ length: 17 }, (_, i) => 1 + i * 0.5)
  const [v, setV] = useState({ tr: ai?.tr ?? 6, cc: ai?.cc ?? 6, lr: ai?.lr ?? 6, gra: ai?.gra ?? 6 })
  const [note, setNote] = useState('')
  const [blind, setBlind] = useState(true)
  const submit = () => start(async () => {
    setMsg(null)
    const res = await fetch('/api/reviews', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ essay_id: id, ...v, note: note || undefined }) })
    const data = await res.json().catch(() => ({}))
    setMsg({ ok: res.ok, text: res.ok ? data.message : data.detail ?? data.title })
    if (res.ok) router.refresh()
  })
  return (
    <div className="stack">
      <p className="muted small">{t('Nilai dulu tanpa melihat skor AI.', 'Mark before seeing the AI score.')}</p>
      <div className="crit">
        {(['tr', 'cc', 'lr', 'gra'] as const).map(k => (
          <label key={k} className="field">
            <span>{k.toUpperCase()}{!blind && ai && <span className="muted small"> · AI {ai[k].toFixed(1)}</span>}</span>
            <select className="select" style={{ width: '100%' }} value={v[k]} onChange={e => setV({ ...v, [k]: Number(e.target.value) })}>
              {bands.map(b => <option key={b} value={b}>{b.toFixed(1)}</option>)}
            </select>
          </label>
        ))}
      </div>
      <textarea className="textarea" rows={2} maxLength={500} placeholder={t('Catatan untuk learner (opsional)', 'Note for the learner (optional)')} value={note} onChange={e => setNote(e.target.value)} />
      <div className="row">
        <button className="btn btn-primary" disabled={pending} onClick={submit}>{pending ? t('Menyimpan...', 'Saving...') : t('Simpan ke ledger', 'Save to the ledger')}</button>
        <button className="btn btn-ghost btn-sm" onClick={() => setBlind(!blind)}>{blind ? t('Tampilkan skor AI', 'Show AI score') : t('Sembunyikan skor AI', 'Hide AI score')}</button>
        {msg && <span className={msg.ok ? 'ok small' : 'bad small'}>{msg.text}</span>}
      </div>
    </div>
  )
}
