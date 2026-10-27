import { createHash } from 'node:crypto'
import { z } from 'zod'
import { apiMe } from '@/lib/auth'
import { asUser } from '@/lib/db'
import { body, handle } from '@/lib/route'

const Body = z.object({ student_id: z.number().int(), scope: z.enum(['ai_feedback', 'audio_retention', 'share_with_institution']),
  action: z.enum(['grant', 'revoke']), kind: z.enum(['guardian', 'self']).optional() })

// The evidence itself (signed form, message) stays with the institution; only its hash is stored.
export function POST(req: Request) {
  return handle(req, async () => {
    const me = await apiMe(['inst_admin', 'platform'])
    const b = await body(req, Body)
    if (b.action === 'grant') {
      const evidence = createHash('sha256').update(`consent:${b.student_id}:${b.scope}:${me.sub}:${new Date().toISOString()}`).digest('hex')
      await asUser(me, tx => tx`select alt.record_consent(${b.student_id}, ${b.scope}, ${b.kind ?? 'self'}, ${evidence})`)
      return Response.json({ message: 'Consent recorded.' })
    }
    await asUser(me, tx => tx`select alt.revoke_consent(${b.student_id}, ${b.scope})`)
    return Response.json({ message: 'Consent revoked. AI feedback is blocked from now on.' })
  })
}
