import { requireMe } from '@/lib/auth'
import { LearnerView } from '@/components/LearnerView'
import { Empty } from '@/components/ui'

export const metadata = { title: 'My readiness' }

export default async function MePage() {
  const me = await requireMe(['student'])
  if (!me.student_id) return <Empty>No learner record is linked to this account.</Empty>
  return <LearnerView me={me} id={me.student_id} self />
}
