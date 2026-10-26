import { apiMe } from '@/lib/auth'
import { asUser } from '@/lib/db'
import { handle } from '@/lib/route'

export function POST() {
  return handle(async () => {
    const me = await apiMe(['platform'])
    const [r] = await asUser(me, tx => tx`select alt.purge_expired() as r`)
    return Response.json({ ...r.r, message: `Purged: ${r.r.essay_text} essay texts, ${r.r.ai_feedback} feedback records.` })
  })
}
