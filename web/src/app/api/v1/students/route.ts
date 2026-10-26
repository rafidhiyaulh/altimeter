import { z } from 'zod'
import { asApi } from '@/lib/db'
import { apiRoute } from '@/lib/api'
import { HttpError } from '@/lib/auth'

const Body = z.object({ students: z.array(z.object({ ref: z.string().min(1).max(64), name: z.string().min(1).max(120),
  cohort: z.string().min(1).max(40), birth_year: z.number().int().min(1940).max(2020).optional() })).min(1).max(500) })

export const POST = apiRoute({ write: true }, async ({ keySha, json }) => {
  const b = Body.safeParse(json)
  if (!b.success) throw new HttpError(400, 'bad_request', b.error.issues[0]?.message)
  const [r] = await asApi(tx => tx`select alt.api_upsert_students(${keySha}, ${JSON.stringify(b.data.students)}::text::jsonb) as n`)
  return { body: { upserted: r.n } }
})
