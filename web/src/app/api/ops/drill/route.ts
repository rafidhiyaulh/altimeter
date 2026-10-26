import { after } from 'next/server'
import { apiMe } from '@/lib/auth'
import { asUser } from '@/lib/db'
import { handle } from '@/lib/route'
import { kickWorkers } from '@/lib/worker'

export const maxDuration = 60

// Resilience drill: queue 60 re-scores, then start one worker that "dies" after 5 messages while holding
// a batch it never deletes. Those messages must come back after the visibility timeout and be finished by
// the others, with exactly one current score per essay at the end.
export function POST(req: Request) {
  return handle(async () => {
    const me = await apiMe(['platform'])
    const [r] = await asUser(me, tx => tx`select alt.start_rescore(60) as id`)
    const origin = process.env.ALT_PUBLIC_URL || new URL(req.url).origin
    after(async () => {
      await fetch(new URL('/api/worker', origin), {
        method: 'POST', headers: { authorization: `Bearer ${process.env.ALT_WORKER_SECRET}`, 'content-type': 'application/json' },
        body: JSON.stringify({ trigger: 'drill-crash', crashAfter: 5 }), signal: AbortSignal.timeout(50000),
      }).catch(() => null)
      await kickWorkers(origin, 2, 'drill')
    })
    return Response.json({ id: r.id, message: `Drill #${r.id}: a worker will die mid-batch; watch the batch finish anyway.` })
  })
}
