'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { tokenize } from '@/lib/essay/features'
import { useT } from './Lang'

type Prompt = { id: number; body: string; question_type: string }

export function WriteEssay({ prompts }: { prompts: Prompt[] }) {
  const { t } = useT()
  const router = useRouter()
  const [pick, setPick] = useState(prompts[0]?.id)
  const [text, setText] = useState('')
  const [started, setStarted] = useState<number | null>(null)
  const [now, setNow] = useState(0)
  const [err, setErr] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const words = useMemo(() => tokenize(text).length, [text])
  useEffect(() => {
    if (!started) return
    const i = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(i)
  }, [started])
  const left = started && now ? Math.max(0, 40 * 60 - Math.floor((now - started) / 1000)) : 40 * 60
  const mmss = `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`
  const prompt = prompts.find(p => p.id === pick)
  const submit = () => start(async () => {
    setErr(null)
    const res = await fetch('/api/essays', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt_id: pick, body: text }) })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) { setErr(data.detail ?? data.title ?? 'Failed'); return }
    router.push(`/essays/${data.id}`)
  })
  const qt: Record<string, string> = { discuss_both: t('Bahas dua pandangan', 'Discuss both views'), adv_disadv: t('Untung-rugi', 'Advantages / disadvantages'),
    cause_solution: t('Sebab & solusi', 'Causes & solutions'), opinion: t('Pendapat', 'Opinion'), two_part: t('Dua pertanyaan', 'Two-part question') }
  return (
    <div className="stack-16">
      <div className="choice" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
        {prompts.map(p => (
          <button key={p.id} type="button" className={p.id === pick ? 'on' : undefined} onClick={() => setPick(p.id)}>
            <span><span className="h">{qt[p.question_type] ?? p.question_type}</span><span className="t" style={{ fontWeight: 500 }}>{p.body.length > 160 ? p.body.slice(0, 160) + '…' : p.body}</span></span>
          </button>
        ))}
      </div>
      {prompt && <p className="prompt-box">{prompt.body}</p>}
      <textarea className="textarea writer" value={text} onChange={e => { setText(e.target.value); if (!started) { const at = e.timeStamp ? performance.timeOrigin + e.timeStamp : 0; setStarted(at); setNow(at) } }}
        placeholder={t('Minimal 250 kata, 40 menit.', 'At least 250 words, 40 minutes.')} />
      <div className="row between">
        <span className="counter">{words} {t('kata', 'words')}{words < 250 && ` · ${250 - words} ${t('lagi untuk 250', 'more to reach 250')}`} · {t('sisa waktu', 'time left')} {mmss}</span>
        <button className="btn btn-primary" disabled={pending || text.length < 200} onClick={submit}>{pending ? t('Mengirim...', 'Submitting...') : t('Kirim untuk dinilai', 'Submit for scoring')}</button>
      </div>
      {err && <p className="alert">{err}</p>}
      <p className="muted small">{t('Skor perkiraan, bukan skor resmi. Teks ke LLM hanya dengan izin.', 'An estimate, not an official score. Text goes to an LLM only with consent.')}</p>
    </div>
  )
}
