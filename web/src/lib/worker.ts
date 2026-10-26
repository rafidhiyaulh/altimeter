import 'server-only'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import { asWorker } from './db'
import { readinessFor, scoreForDb, type LearnerInput } from './scoring'

// Competing consumers on the pgmq queue `alt_jobs`. Any number of these run at once (separate serverless
// invocations). A read message is invisible to others for VT seconds and comes back by itself if the
// worker dies before deleting it (at-least-once delivery); the database functions make every effect
// idempotent (exactly-once effect). After MAX_ATTEMPTS failed reads a message goes to the dead-letter queue.
const VT = 45
const MAX_ATTEMPTS = 3
const BATCH = 20

type Job = { msg_id: number; read_ct: number; message: { kind: 'score'; essay_id: string; rescore?: boolean } | { kind: 'readiness'; student_id: number } }

async function handle(job: Job, worker: string) {
  const m = job.message
  if (m.kind === 'score') {
    const [{ e }] = await asWorker(tx => tx`select alt.w_essay(${m.essay_id}::uuid) as e`)
    if (!e || !e.body) return 'skip'
    const s = scoreForDb(e.prompt, e.body)
    const [{ r }] = await asWorker(tx => tx`select alt.record_score(${m.essay_id}::uuid, ${s.version}, ${Boolean(m.rescore)}, ${JSON.stringify(s.payload)}::text::jsonb, ${worker}) as r`)
    return r as string
  }
  if (m.kind === 'readiness') {
    const [{ l }] = await asWorker(tx => tx`select alt.w_learner(${m.student_id}) as l`)
    if (!l) return 'skip'
    const r = readinessFor(l as LearnerInput)
    await asWorker(tx => tx`select alt.record_readiness(${m.student_id}, ${JSON.stringify(r)}::text::jsonb, ${worker})`)
    return 'readiness'
  }
  throw new Error(`unknown job kind`)
}

// crashAfter: resilience drill only (secret-protected). The worker reads a batch, processes this many
// messages and then "dies" without deleting the rest, which must come back after the visibility timeout.
export async function runWorker(trigger: string, budgetMs = 45000, crashAfter?: number) {
  const worker = `w-${randomUUID().slice(0, 8)}`
  const deadline = Date.now() + budgetMs
  const [{ id: runId }] = await asWorker(tx => tx`select alt.worker_run_start(${worker}, ${trigger}) as id`)
  let processed = 0
  let failed = 0
  let crashed = false
  outer: while (Date.now() < deadline) {
    const jobs = await asWorker(tx => tx`select msg_id, read_ct, message from alt.q_read(${VT}, ${BATCH})`) as unknown as Job[]
    if (jobs.length === 0) break
    for (const job of jobs) {
      if (crashAfter != null && processed >= crashAfter) { crashed = true; break outer }
      if (Date.now() > deadline) break outer // unprocessed messages reappear after VT
      try {
        await handle(job, worker)
        await asWorker(tx => tx`select alt.q_delete(${job.msg_id})`)
        processed++
      } catch (e) {
        failed++
        const msg = (e as Error).message
        const [{ v }] = await asWorker(tx => tx`select alt.q_fail(${job.msg_id}, ${job.read_ct}, ${msg}, ${MAX_ATTEMPTS}) as v`)
        if (v === 'dead' && job.message.kind === 'score') await asWorker(tx => tx`select alt.score_failed(${job.message.kind === 'score' ? job.message.essay_id : null}::uuid)`)
        console.error('job failed', worker, job.msg_id, v, msg)
      }
    }
  }
  await asWorker(tx => tx`select alt.worker_run_end(${runId}, ${processed}, ${failed})`)
  return { worker, processed, failed, crashed }
}

export function workerAuthorized(req: Request) {
  const secret = process.env.ALT_WORKER_SECRET ?? ''
  const got = (req.headers.get('authorization') ?? '').replace(/^Bearer /, '')
  const a = Buffer.from(got)
  const b = Buffer.from(secret)
  return secret.length > 0 && a.length === b.length && timingSafeEqual(a, b)
}

// Fan out: n independent HTTP invocations of /api/worker, each its own function instance.
export async function kickWorkers(origin: string, n: number, trigger: string) {
  const url = new URL('/api/worker', process.env.ALT_PUBLIC_URL || origin)
  await Promise.allSettled(Array.from({ length: n }, () =>
    fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${process.env.ALT_WORKER_SECRET}`, 'content-type': 'application/json' },
      body: JSON.stringify({ trigger }),
      signal: AbortSignal.timeout(2500),
    }).catch(() => null)))
}
