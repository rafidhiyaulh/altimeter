import { runWorker, workerAuthorized } from '@/lib/worker'

export const maxDuration = 60

// Called by pg_cron through pg_net every minute while the queue is not empty, and by fan-out after a
// submission or batch. Bearer secret only (kept in Supabase Vault for cron), never a user session.
export async function POST(request: Request) {
  if (!workerAuthorized(request)) return Response.json({ error: 'forbidden' }, { status: 403 })
  const body = await request.json().catch(() => ({}))
  const trigger = typeof body?.trigger === 'string' ? body.trigger.slice(0, 20) : 'http'
  const crashAfter = Number.isInteger(body?.crashAfter) ? Number(body.crashAfter) : undefined
  const result = await runWorker(trigger, 45000, crashAfter)
  return Response.json(result)
}
