import { z } from 'zod'
import { asApi } from '@/lib/db'
import { apiRoute } from '@/lib/api'
import { HttpError } from '@/lib/auth'

const hb = z.number().min(0).max(9).refine(v => Math.abs(v * 2 - Math.round(v * 2)) < 1e-9, 'half band')
const Body = z.object({ student_ref: z.string().min(1).max(64), test_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reading: hb, listening: hb, writing: hb, speaking: hb, overall: hb, verified: z.enum(['self_reported', 'trf_verified']).default('self_reported') })

// Official results are what calibrates every practice score; TRF-verified ones weigh most in review.
export const POST = apiRoute({ write: true }, async ({ keySha, json }) => {
  const b = Body.safeParse(json)
  if (!b.success) throw new HttpError(400, 'bad_request', b.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).slice(0, 3).join('; '))
  const { student_ref, ...row } = b.data
  const [r] = await asApi(tx => tx`select alt.api_official(${keySha}, ${student_ref}, ${JSON.stringify(row)}::text::jsonb) as id`)
  return { status: 201, body: { id: r.id } }
})
