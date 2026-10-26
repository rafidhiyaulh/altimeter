import { z } from 'zod'
import { apiMe } from '@/lib/auth'
import { asUser } from '@/lib/db'
import { body, handle } from '@/lib/route'

const Body = z.object({ student_id: z.number().int(), kind: z.enum(['export', 'erase']) })

export function POST(req: Request) {
  return handle(async () => {
    const me = await apiMe(['inst_admin', 'platform'])
    const b = await body(req, Body)
    const [r] = await asUser(me, tx => tx`select alt.request_dsr(${b.student_id}, ${b.kind}) as id`)
    return Response.json({ id: r.id, message: `Request #${r.id} opened. Complete it on the Privacy page.` })
  })
}
