'use client'

import { createContext, useContext, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { LANG_COOKIE, setClientLang, tFor, type Lang, type T } from '@/lib/i18n'

const Ctx = createContext<Lang>('en')

// The choice lives in a cookie (read by the server) and the document lang attribute.
function persistLang(l: Lang) {
  document.cookie = `${LANG_COOKIE}=${l}; path=/; max-age=31536000; samesite=lax`
  document.documentElement.lang = l
  setClientLang(l)
}

export function LangProvider({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  setClientLang(lang)
  return <Ctx.Provider value={lang}>{children}</Ctx.Provider>
}

export function useT(): { t: T; lang: Lang } {
  const lang = useContext(Ctx)
  return { t: tFor(lang), lang }
}

export function LangToggle() {
  const { lang } = useT()
  const router = useRouter()
  const [pending, start] = useTransition()
  const set = (l: Lang) => {
    if (l === lang) return
    persistLang(l)
    start(() => router.refresh())
  }
  return (
    <div className="seg seg-sm lang-toggle" role="group" aria-label={lang === 'en' ? 'Language' : 'Bahasa'} aria-busy={pending || undefined}>
      {(['en', 'id'] as const).map(l => (
        <button key={l} type="button" className={l === lang ? 'on' : undefined} aria-pressed={l === lang} onClick={() => set(l)}>{l.toUpperCase()}</button>
      ))}
    </div>
  )
}
