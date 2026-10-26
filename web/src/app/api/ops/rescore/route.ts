import { after } from 'next/server'
import { z } from 'zod'
import { apiMe } from '@/lib/auth'
import { asUser } from '@/lib/db'
import { body, handle } from '@/lib/route'
import { kickWorkers } from '@/lib/worker'

const Body = z.object({ n: z.number().int().min(1).max(1000) })

// Load test and model-upgrade drill: re-score n essays through the queue with 4 competing workers.
export function POST(req: Request) {
  return handle(async () => {
    const me = await apiMe(['platform'])
    const { n } = await body(req, Body)
    const [r] = await asUser(me, tx => tx`select alt.start_rescore(${n}) as id`)
    after(() => kickWorkers(new URL(req.url).origin, 4, 'rescore'))
    return Response.json({ id: r.id, message: `Batch #${r.id}: ${n} essays queued for 4 workers.` })
  })
}
