'use client'

import { useState, useTransition, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { useT } from './Lang'

// A button that POSTs JSON to an API route, shows the outcome inline and refreshes the page data.
// confirmText: a second click is required (inline, never a browser dialog).
export function ActionButton({ url, body, children, confirmText, primary, small, onDone, download }: {
  url: string; body?: unknown; children: ReactNode; confirmText?: string; primary?: boolean; small?: boolean
  onDone?: (data: unknown) => void; download?: string
}) {
  const { t } = useT()
  const router = useRouter()
  const [pending, start] = useTransition()
  const [armed, setArmed] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const run = () => {
    if (confirmText && !armed) { setArmed(true); return }
    setArmed(false)
    start(async () => {
      setMsg(null)
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) })
      if (download && res.ok) {
        const blob = await res.blob()
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = download
        a.click()
        URL.revokeObjectURL(a.href)
        setMsg({ ok: true, text: t('Diunduh.', 'Downloaded.') })
        router.refresh()
        return
      }
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setMsg({ ok: false, text: data.detail ?? data.title ?? t('Gagal.', 'Failed.') }); return }
      setMsg({ ok: true, text: data.message ?? t('Selesai.', 'Done.') })
      onDone?.(data)
      router.refresh()
    })
  }
  return (
    <span className="row" style={{ gap: 8 }}>
      <button type="button" className={`btn${primary ? ' btn-primary' : ''}${small ? ' btn-sm' : ''}`} disabled={pending} onClick={run}>
        {pending ? t('Memproses...', 'Working...') : armed ? confirmText : children}
      </button>
      {armed && <button type="button" className={`btn btn-ghost${small ? ' btn-sm' : ''}`} onClick={() => setArmed(false)}>{t('Batal', 'Cancel')}</button>}
      {msg && <span className={msg.ok ? 'ok small' : 'bad small'} role="status">{msg.text}</span>}
    </span>
  )
}
