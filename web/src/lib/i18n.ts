import { cache } from 'react'

// Two languages, English (default) and Indonesian. Text is written in pairs where it is used,
// t('Indonesian', 'English'), so a translation can never fall behind its original. Terms that are standard
// in English (band, QWK, RLS, endpoint) stay the same on both sides.
export type Lang = 'id' | 'en'
export const LANG_COOKIE = 'alt_lang'
export type T = (id: string, en: string) => string

export const asLang = (v: string | null | undefined): Lang => (v === 'id' ? 'id' : 'en')
export const tFor = (lang: Lang): T => (id, en) => (lang === 'en' ? en : id)
export const localeOf = (lang: Lang) => (lang === 'en' ? 'en-GB' : 'id-ID')

// Language of the request being rendered: per request on the server (React cache, set by getT()),
// once in the browser (LangProvider).
const serverStore = cache(() => ({ lang: null as Lang | null }))
let clientLang: Lang = 'en'
export function setClientLang(l: Lang) { clientLang = l }
export function setRequestLang(l: Lang) { try { serverStore().lang = l } catch {} }
export function currentLang(): Lang {
  if (typeof window !== 'undefined') return clientLang
  try { return serverStore().lang ?? clientLang } catch { return clientLang }
}

export const tr = (id: string, en: string) => (currentLang() === 'en' ? en : id)
export function bilingual<K extends string>(m: Record<K, readonly [string, string]>): Record<K, string> {
  const o = {} as Record<K, string>
  for (const k of Object.keys(m) as K[]) Object.defineProperty(o, k, { enumerable: true, get: () => tr(m[k][0], m[k][1]) })
  return o
}
