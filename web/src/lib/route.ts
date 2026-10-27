import 'server-only'
import { z } from 'zod'
import { apiError, HttpError } from './auth'
import { logRequest } from './observe'

// Parse a JSON body with a zod schema; malformed input is a 400 with the first issue.
export async function body<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  const raw = await req.json().catch(() => { throw new HttpError(400, 'bad_request', 'Body must be JSON.') })
  const r = schema.safeParse(raw)
  if (!r.success) throw new HttpError(400, 'bad_request', r.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '))
  return r.data
}

export async function handle(req: Request, fn: () => Promise<Response>) {
  const started = Date.now()
  const res = await fn().catch(apiError)
  logRequest(req, res.status, started)
  return res
}

export const halfBand = z.number().min(1).max(9).refine(v => Math.abs(v * 2 - Math.round(v * 2)) < 1e-9, 'must be a half band')
