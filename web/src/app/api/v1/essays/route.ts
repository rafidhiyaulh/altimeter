import { after } from 'next/server'
import { z } from 'zod'
import { asApi } from '@/lib/db'
import { apiRoute } from '@/lib/api'
import { HttpError } from '@/lib/auth'
import { questionType, tokenize } from '@/lib/essay/features'
import { kickWorkers } from '@/lib/worker'

const Body = z.object({ student_ref: z.string().min(1).max(64), prompt: z.string().min(20).max(2000), body: z.string().min(200).max(12000) })

// Queue an essay for scoring; poll GET /api/v1/essays/{id} for the result.
export const POST = apiRoute({ write: true }, async ({ keySha, json }) => {
  const b = Body.safeParse(json)
  if (!b.success) throw new HttpError(400, 'bad_request', b.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).slice(0, 3).join('; '))
  const [r] = await asApi(tx => tx`select alt.api_submit_essay(${keySha}, ${b.data.student_ref}, ${b.data.prompt}, ${questionType(b.data.prompt)}, ${b.data.body}, ${tokenize(b.data.body).length}) as id`)
  after(() => kickWorkers(process.env.ALT_PUBLIC_URL ?? '', 1, 'api'))
  return { status: 202, body: { id: r.id, status: 'queued', poll: `/api/v1/essays/${r.id}` } }
})
