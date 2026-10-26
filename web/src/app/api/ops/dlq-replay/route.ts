import { after } from 'next/server'
import { apiMe } from '@/lib/auth'
import { asUser } from '@/lib/db'
import { handle } from '@/lib/route'
import { kickWorkers } from '@/lib/worker'

export function POST(req: Request) {
  return handle(async () => {
    const me = await apiMe(['platform'])
    const [r] = await asUser(me, tx => tx`select alt.dlq_replay() as n`)
    if (r.n > 0) after(() => kickWorkers(new URL(req.url).origin, 1, 'replay'))
    return Response.json({ n: r.n, message: `${r.n} messages moved back to the queue.` })
  })
}
