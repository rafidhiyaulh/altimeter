import { requireMe } from '@/lib/auth'
import { asUser } from '@/lib/db'
import { getT, titled } from '@/lib/i18n-server'
import { PageHead } from '@/components/ui'
import { WriteEssay } from '@/components/WriteEssay'

export const generateMetadata = titled('Tulis esai', 'Write an essay')

// Three prompts of different question types, fresh each visit.
export default async function WritePage() {
  const me = await requireMe(['student'])
  const { t } = await getT()
  const prompts = await asUser(me, tx => tx`
    select distinct on (question_type) id, body, question_type from (
      select id, body, question_type from alt.prompts where length(body) between 80 and 400 order by random() limit 60) x
    order by question_type, random() limit 3`)
  return (
    <>
      <PageHead title={t('Tulis esai Task 2', 'Write a Task 2 essay')} sub={t('Skor keluar dalam beberapa detik.', 'Scored in a few seconds.')} />
      <WriteEssay prompts={prompts as unknown as { id: number; body: string; question_type: string }[]} />
    </>
  )
}
