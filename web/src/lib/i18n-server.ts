import 'server-only'
import { cookies } from 'next/headers'
import { asLang, LANG_COOKIE, setRequestLang, tFor, type Lang, type T } from './i18n'

export async function getLang(): Promise<Lang> {
  const lang = asLang((await cookies()).get(LANG_COOKIE)?.value)
  setRequestLang(lang)
  return lang
}

// Called at the top of every page / server action: t('Indonesia', 'English').
export async function getT(): Promise<{ t: T; lang: Lang }> {
  const lang = await getLang()
  return { t: tFor(lang), lang }
}

export const titled = (id: string, en: string) => async () => ({ title: `${(await getT()).t(id, en)} · Altimeter` })
