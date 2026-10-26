import { notFound } from 'next/navigation'
import { requireMe } from '@/lib/auth'
import { LearnerView } from '@/components/LearnerView'

export const metadata = { title: 'Learner · Altimeter' }

export default async function LearnerPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireMe()
  const id = Number((await params).id)
  if (!Number.isInteger(id)) notFound()
  return <LearnerView me={me} id={id} self={me.student_id === id} />
}
