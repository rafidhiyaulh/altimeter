'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useT } from './Lang'
import { ActionButton } from './Action'
import { dateTime } from '@/lib/format'

type Status = {
  queue: { depth: number; dlq: number; oldest_s: number | null }
  batch: { id: number; n: number; started_at: string; done: number; last_at: string | null; workers: number } | null
  duplicate_current: number
  runs: { worker: string; trigger: string; started_at: string; ended_at: string | null; processed: number | null; failed: number | null }[] | null
}

// Live queue and batch progress, polled every 2 s while something is running.
export function OpsPanel() {
  const { t } = useT()
  const [s, setS] = useState<Status | null>(null)
  const [n, setN] = useState(300)
  useEffect(() => {
    let stop = false
    const tick = async () => {
      const r = await fetch('/api/ops/status', { cache: 'no-store' }).then(x => x.json()).catch(() => null)
      if (!stop && r) setS(r)
      if (!stop) setTimeout(tick, 2000)
    }
    tick()
    return () => { stop = true }
  }, [])
  const b = s?.batch
  const secs = b?.last_at ? (new Date(b.last_at).getTime() - new Date(b.started_at).getTime()) / 1000 : null
  return (
    <div className="stack">
      <div className="kv c4">
        <div><div className="k">{t('Job menunggu', 'Jobs waiting')}</div><div className="v">{s?.queue.depth ?? '-'}</div></div>
        <div><div className="k">{t('Job gagal (DLQ)', 'Failed jobs (DLQ)')}</div><div className="v">{s?.queue.dlq ?? '-'}</div></div>
        <div><div className="k">{t('Skor dobel', 'Double scores')}</div><div className={`v ${s?.duplicate_current ? 'bad' : 'ok'}`}>{s?.duplicate_current ?? '-'}</div></div>
        <div><div className="k">{t('Worker, 10 menit', 'Workers, 10 min')}</div><div className="v">{s?.runs?.length ?? 0}</div></div>
      </div>
      {b && (
        <div className="note info">
          {t('Batch', 'Batch')} #{b.id}: <b>{b.done}</b> / {b.n} {t('esai dinilai ulang', 'essays re-scored')} {t('oleh', 'by')} {b.workers} worker
          {secs != null && b.done > 0 && <>{t(`, ${(b.done / Math.max(1, secs)).toFixed(1)} esai per detik, ${secs.toFixed(0)} detik.`, `, ${(b.done / Math.max(1, secs)).toFixed(1)} essays per second, ${secs.toFixed(0)} s.`)}</>}
          <div className="track" style={{ height: 4, background: 'var(--panel-alt)', borderRadius: 2, marginTop: 6 }}>
            <div style={{ height: '100%', width: `${Math.min(100, (b.done / Math.max(1, b.n)) * 100)}%`, background: 'var(--brand)', borderRadius: 2 }} />
          </div>
        </div>
      )}
      <div className="row">
        <input className="input" type="number" min={1} max={1000} value={n} onChange={e => setN(Number(e.target.value))} style={{ width: 90 }} aria-label="n" />
        <ActionButton primary small url="/api/ops/rescore" body={{ n }}>{t('Nilai ulang batch (uji beban)', 'Re-score batch (load test)')}</ActionButton>
        <ActionButton small url="/api/ops/drill">{t('Uji ketahanan: worker mati', 'Resilience drill: kill a worker')}</ActionButton>
        <ActionButton small url="/api/ops/dlq-replay">{t('Putar ulang DLQ', 'Replay DLQ')}</ActionButton>
      </div>
      {s?.runs && s.runs.length > 0 && (
        <table className="data">
          <thead><tr><th>Worker</th><th>{t('Pemicu', 'Trigger')}</th><th className="num">{t('Diproses', 'Processed')}</th><th className="num">{t('Gagal', 'Failed')}</th><th>{t('Status', 'State')}</th></tr></thead>
          <tbody>{s.runs.map(r => (
            <tr key={r.worker}><td className="mono small">{r.worker}</td><td>{r.trigger}</td><td className="num">{r.processed ?? '…'}</td><td className="num">{r.failed ?? '…'}</td>
              <td>{r.ended_at ? t('selesai', 'done') : r.trigger === 'drill-crash' ? t('mati (disengaja)', 'died (on purpose)') : t('berjalan', 'running')}</td></tr>))}</tbody>
        </table>
      )}
    </div>
  )
}

export function ApiKeys({ institutions, keys }: { institutions: { id: number; name: string }[]; keys: { id: number; institution: string; prefix: string; label: string; created_at: string; last_used_at: string | null; revoked_at: string | null }[] }) {
  const { t, lang } = useT()
  const router = useRouter()
  const [inst, setInst] = useState(institutions[0]?.id)
  const [label, setLabel] = useState('Acsent platform')
  const [shown, setShown] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const active = keys.filter(k => !k.revoked_at)
  const revoked = keys.length - active.length
  const create = () => start(async () => {
    const r = await fetch('/api/ops/api-keys', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ institution_id: inst, label }) }).then(x => x.json())
    if (r.key) setShown(r.key)
    router.refresh()
  })
  return (
    <div className="stack">
      <div className="row">
        <select className="select" value={inst} onChange={e => setInst(Number(e.target.value))}>{institutions.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</select>
        <input className="input" value={label} onChange={e => setLabel(e.target.value)} maxLength={60} aria-label="label" />
        <button className="btn btn-sm btn-primary" disabled={pending} onClick={create}>{t('Buat key', 'Create key')}</button>
      </div>
      {shown && <div><div className="muted small">{t('Salin sekarang. Key ini tidak akan ditampilkan lagi.', 'Copy it now. It will not be shown again.')}</div><div className="key-once">{shown}</div></div>}
      <div className="table-wrap"><table className="data">
        <thead><tr><th>{t('Key', 'Key')}</th><th>{t('Label', 'Label')}</th><th>{t('Terakhir dipakai', 'Last used')}</th><th /></tr></thead>
        <tbody>{active.map(k => (
          <tr key={k.id}><td><span className="mono small">alt_live_{k.prefix}…</span><div className="muted small">{k.institution}</div></td><td>{k.label}</td>
            <td className="small nowrap">{k.last_used_at ? dateTime(k.last_used_at, lang) : t('belum pernah', 'never')}</td>
            <td className="num"><ActionButton small url={`/api/ops/api-keys/${k.id}`} confirmText={t('Cabut key ini?', 'Revoke this key?')}>{t('Cabut', 'Revoke')}</ActionButton></td></tr>))}
          {active.length === 0 && <tr><td colSpan={4} className="muted">{t('Belum ada key aktif.', 'No active keys.')}</td></tr>}
        </tbody>
      </table></div>
      {revoked > 0 && <div className="muted small">{t(`${revoked} key sudah dicabut dan tidak bisa dipakai lagi.`, `${revoked} revoked keys can no longer be used.`)}</div>}
    </div>
  )
}
