import { asWorker } from '@/lib/db'
import { llmConfigured, llmModel } from '@/lib/llm'
import { writingModel, prior } from '@/lib/scoring'

export const dynamic = 'force-dynamic'

// Liveness for the database, queue, models and LLM, plus the region and commit actually serving traffic.
export async function GET() {
  const started = Date.now()
  let db: object = { ok: false }
  try {
    const [r] = await asWorker(tx => tx`select alt.q_stats() as q, now() as at`)
    db = { ok: true, ms: Date.now() - started, queue: r.q }
  } catch (e) {
    db = { ok: false, error: (e as Error).message.slice(0, 120) }
  }
  return Response.json({
    ok: (db as { ok: boolean }).ok,
    db,
    models: { writing: writingModel.version, readiness: prior.version },
    llm: { configured: llmConfigured(), model: llmModel() },
    region: process.env.VERCEL_REGION ?? 'local',
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
  }, { headers: { 'cache-control': 'no-store' } })
}
