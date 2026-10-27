import { after } from 'next/server'
import { z } from 'zod'
import { apiMe } from '@/lib/auth'
import { asUser } from '@/lib/db'
import { tokenize } from '@/lib/essay/features'
import { body, handle } from '@/lib/route'
import { kickWorkers } from '@/lib/worker'

const Body = z.object({ prompt_id: z.number().int().positive(), body: z.string().min(200).max(12000) })

// A learner submits an essay: stored and queued in one transaction, then one worker is woken right away
// (pg_cron is the safety net if that wake-up is lost).
export function POST(req: Request) {
  return handle(req, async () => {
    const me = await apiMe(['student'])
    const b = await body(req, Body)
    const words = tokenize(b.body).length
    const [r] = await asUser(me, tx => tx`select alt.submit_essay(${b.prompt_id}, ${b.body}, ${words}) as id`)
    after(() => kickWorkers(new URL(req.url).origin, 1, 'submit'))
    return Response.json({ id: r.id, status: 'queued' }, { status: 202 })
  })
}
