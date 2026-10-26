import { currentLang, localeOf, type Lang } from './i18n'

// Every formatter follows the active language. Client components pass lang explicitly so the server
// render and the browser render match.
const L = (lang?: Lang) => localeOf(lang ?? currentLang())

export const num = (v: number | null | undefined, lang?: Lang) => (v == null || Number.isNaN(v) ? '-' : v.toLocaleString(L(lang)))
export const pct = (v: number | null | undefined, digits = 0, lang?: Lang) =>
  v == null || Number.isNaN(v) ? '-' : `${(v * 100).toLocaleString(L(lang), { maximumFractionDigits: digits })}%`
export const dec = (v: number | null | undefined, digits = 2, lang?: Lang) =>
  v == null || Number.isNaN(v) ? '-' : v.toLocaleString(L(lang), { minimumFractionDigits: 0, maximumFractionDigits: digits })
// IELTS bands always show one decimal: 6.0, 6.5.
export const band = (v: number | string | null | undefined, lang?: Lang) =>
  v == null || v === '' || Number.isNaN(Number(v)) ? '-' : Number(v).toLocaleString(L(lang), { minimumFractionDigits: 1, maximumFractionDigits: 1 })
export const signed = (v: number | null | undefined, digits = 2, lang?: Lang) =>
  v == null || Number.isNaN(v) ? '-' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toLocaleString(L(lang), { minimumFractionDigits: digits, maximumFractionDigits: digits })}`

// All times shown in WIB, so the server (UTC) and the browser produce the same text.
export const TZ = 'Asia/Jakarta'
export const date = (v: string | Date | number | null | undefined, lang?: Lang) =>
  v == null ? '-' : new Date(v).toLocaleDateString(L(lang), { day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ })
export const shortDate = (v: string | Date | number | null | undefined, lang?: Lang) =>
  v == null ? '-' : new Date(v).toLocaleDateString(L(lang), { day: 'numeric', month: 'short', timeZone: TZ })
export const dateTime = (v: string | Date | number | null | undefined, lang?: Lang) =>
  v == null ? '-' : new Date(v).toLocaleString(L(lang), { dateStyle: 'medium', timeStyle: 'short', timeZone: TZ })

export function ago(v: string | Date | number | null | undefined, lang?: Lang) {
  if (v == null) return '-'
  const en = (lang ?? currentLang()) === 'en'
  const s = (Date.now() - new Date(v).getTime()) / 1000
  if (s < 90) return en ? 'just now' : 'baru saja'
  if (s < 3600) return en ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 60)} menit lalu`
  if (s < 86400 * 2) return en ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 3600)} jam lalu`
  return en ? `${Math.round(s / 86400)} days ago` : `${Math.round(s / 86400)} hari lalu`
}

// Request time for server components (rendered once per request, so reading the clock is intended).
export const requestNow = () => Date.now()
