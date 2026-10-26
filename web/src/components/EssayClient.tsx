'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useT } from './Lang'
import { CornerDownRight } from 'lucide-react'

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

type Crit = 'tr' | 'cc' | 'lr' | 'gra'
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
              {it.suggestion && <div className="sug small row" style={{ gap: 6, alignItems: 'flex-start', flexWrap: 'nowrap' }}><CornerDownRight size={13} style={{ marginTop: 3, flex: 'none' }} aria-hidden /><span>{it.suggestion}</span></div>}
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
          {!aiAllowed && <>{t('. Belum ada izin AI, jadi esai tidak dikirim ke AI.', '. No AI consent, so the essay is not sent to AI.')}</>}
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

export function ReviewForm({ id, blind }: { id: string; blind: boolean }) {
  const { t } = useT()
  const router = useRouter()
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const bands = Array.from({ length: 17 }, (_, i) => 1 + i * 0.5)
  // Blind marking: start empty so the AI score cannot anchor the teacher.
  const [v, setV] = useState<Record<Crit, number | null>>({ tr: null, cc: null, lr: null, gra: null })
  const [note, setNote] = useState('')
  const ready = Object.values(v).every(x => x != null)
  const name: Record<Crit, string> = { tr: t('Isi & tugas', 'Task'), cc: t('Alur', 'Flow'), lr: t('Kosakata', 'Vocabulary'), gra: t('Tata bahasa', 'Grammar') }
  const submit = () => start(async () => {
    setMsg(null)
    const res = await fetch('/api/reviews', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ essay_id: id, ...v, note: note || undefined }) })
    const data = await res.json().catch(() => ({}))
    setMsg({ ok: res.ok, text: res.ok ? data.message : data.detail ?? data.title })
    if (res.ok) router.refresh()
  })
  return (
    <div className="stack">
      <p className="muted small">{blind ? t('Skor AI disembunyikan sampai Anda menyimpan nilai, agar penilaian tidak terpengaruh.', 'The AI score stays hidden until you save, so it cannot sway your marks.')
        : t('Nilai Anda dibandingkan dengan skor AI di halaman Kepercayaan skor.', 'Your marks are compared with the AI score on the Score trust page.')}</p>
      <div className="crit">
        {(['tr', 'cc', 'lr', 'gra'] as const).map(k => (
          <label key={k} className="field">
            <span title={CRIT[k.toUpperCase()]}>{name[k]}</span>
            <select className="select" style={{ width: '100%' }} value={v[k] ?? ''} onChange={e => setV({ ...v, [k]: Number(e.target.value) })}>
              <option value="" disabled>{t('Pilih', 'Choose')}</option>
              {bands.map(b => <option key={b} value={b}>{b.toFixed(1)}</option>)}
            </select>
          </label>
        ))}
      </div>
      <textarea className="textarea" rows={2} maxLength={500} placeholder={t('Catatan untuk learner (opsional)', 'Note for the learner (optional)')} value={note} onChange={e => setNote(e.target.value)} />
      <div className="row">
        <button className="btn btn-primary" disabled={pending || !ready} onClick={submit}>{pending ? t('Menyimpan...', 'Saving...') : t('Simpan nilai', 'Save marks')}</button>
        {!ready && !msg && <span className="muted small">{t('Isi keempat nilai dulu.', 'Fill in all four marks first.')}</span>}
        {msg && <span className={msg.ok ? 'ok small' : 'bad small'}>{msg.text}</span>}
      </div>
    </div>
  )
}
