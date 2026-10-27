import { z } from 'zod'
import { apiMe } from '@/lib/auth'
import { asUser } from '@/lib/db'
import { body, halfBand, handle } from '@/lib/route'

const Body = z.object({ essay_id: z.string().uuid(), tr: halfBand, cc: halfBand, lr: halfBand, gra: halfBand, note: z.string().max(500).optional() })

export function POST(req: Request) {
  return handle(req, async () => {
    const me = await apiMe(['teacher', 'inst_admin', 'platform'])
    const b = await body(req, Body)
    const [r] = await asUser(me, tx => tx`select alt.submit_review(${b.essay_id}::uuid, ${b.tr}, ${b.cc}, ${b.lr}, ${b.gra}, ${b.note ?? null}) as seq`)
    return Response.json({ seq: r.seq, message: `Saved to the review ledger as #${r.seq}.` })
  })
}
