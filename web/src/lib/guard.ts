import 'server-only'
import { asUser } from './db'
import { HttpError, type Me } from './auth'

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Per-user fixed-window limit, counted in Postgres so it holds across all serverless instances.
export async function rateLimit(me: Me, bucket: string, max: number, windowS: number) {
  const [r] = await asUser(me, tx => tx`select alt.hit(${bucket + ':' + me.sub}, ${max}, ${windowS}) as ok`)
  if (!r.ok) throw new HttpError(429, 'rate_limited', 'Too many requests, slow down a little.')
}

// LLM budget: per user and global token buckets. Out of tokens => callers use the deterministic fallback.
export async function llmBudget(me: Me | null): Promise<boolean> {
  const userCap = Number(process.env.LLM_USER_CAPACITY ?? 20)
  const userRefill = Number(process.env.LLM_USER_REFILL_PER_HOUR ?? 20)
  const globalCap = Number(process.env.LLM_GLOBAL_CAPACITY ?? 400)
  const globalRefill = Number(process.env.LLM_GLOBAL_REFILL_PER_HOUR ?? 200)
  const run = async (tx: import('./db').Tx) => {
    if (me) {
      const [u] = await tx`select alt.take_token(${'llm:user:' + me.sub}, ${userCap}, ${userRefill}) as ok`
      if (!u.ok) return false
    }
    const [g] = await tx`select alt.take_token('llm:global', ${globalCap}, ${globalRefill}) as ok`
    return Boolean(g.ok)
  }
  if (me) return asUser(me, run)
  const { asWorker } = await import('./db')
  return asWorker(run)
}
