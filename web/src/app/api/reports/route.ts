import { z } from 'zod'
import { apiMe } from '@/lib/auth'
import { asUser } from '@/lib/db'
import { llmBudget, rateLimit } from '@/lib/guard'
import { llmModel } from '@/lib/llm'
import { cohortFacts, draftReport, rulesReport } from '@/lib/report'
import { body, handle } from '@/lib/route'

const Body = z.object({ cohort_id: z.number().int(), lang: z.enum(['en', 'id']) })

export function POST(req: Request) {
  return handle(async () => {
    const me = await apiMe(['teacher', 'inst_admin', 'platform'])
    const b = await body(req, Body)
    await rateLimit(me, 'report', 10, 600)
    const { facts, cohort } = await asUser(me, tx => cohortFacts(tx, b.cohort_id))
    let source: 'llm' | 'rules' = 'rules'
    let dropped = 0
    let report = null
    if (await llmBudget(me)) {
      const r = await draftReport(facts, cohort, b.lang)
      dropped = r.dropped
      await asUser(me, tx => tx`select alt.log_llm('cohort_report', ${llmModel()}, ${r.sha || 'none'}, ${r.ms}, ${Boolean(r.report)}, ${r.dropped})`)
      if (r.report) { report = r.report; source = 'llm' }
    }
    report ??= rulesReport(facts, b.lang)
    const [s] = await asUser(me, tx => tx`select alt.save_report(${b.cohort_id}::smallint, ${b.lang}, ${JSON.stringify(facts)}::text::jsonb, ${JSON.stringify(report)}::text::jsonb, ${source}, ${dropped}) as id`)
    return Response.json({ id: s.id, source, dropped, message: source === 'llm' ? 'Report drafted (LLM, fact-checked).' : 'Report drafted (rule-based).' })
  })
}
