import { after } from 'next/server'
import { z } from 'zod'
import { asApi } from '@/lib/db'
import { apiRoute } from '@/lib/api'
import { HttpError } from '@/lib/auth'
import { kickWorkers } from '@/lib/worker'

const Attempt = z.object({
  student_ref: z.string().min(1).max(64),
  skill: z.enum(['reading', 'listening', 'writing', 'speaking']),
  source: z.enum(['practice', 'mock', 'ai_speaking']),
  band: z.number().min(0).max(9).refine(v => Math.abs(v * 2 - Math.round(v * 2)) < 1e-9, 'band must be a half band'),
  raw_score: z.number().int().min(0).max(40).optional(),
  taken_at: z.string().datetime({ offset: true }),
})
const Body = z.object({ attempts: z.array(Attempt).min(1).max(500) })

// Practice results from the prep platform. Each affected learner gets one (coalesced) readiness job.
export const POST = apiRoute({ write: true }, async ({ keySha, json }) => {
  const b = Body.safeParse(json)
  if (!b.success) throw new HttpError(400, 'bad_request', b.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).slice(0, 3).join('; '))
  const [r] = await asApi(tx => tx`select alt.api_ingest_attempts(${keySha}, ${JSON.stringify(b.data.attempts)}::text::jsonb) as r`)
  if (r.r.readiness_jobs > 0) after(() => kickWorkers(process.env.ALT_PUBLIC_URL ?? '', 1, 'api'))
  return { status: 202, body: r.r }
})
