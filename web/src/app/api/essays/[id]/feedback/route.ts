import { z } from 'zod'
import { apiMe, HttpError } from '@/lib/auth'
import { asUser } from '@/lib/db'
import { llmFeedback, rulesFeedback } from '@/lib/feedback'
import { llmBudget, rateLimit, UUID } from '@/lib/guard'
import { llmModel } from '@/lib/llm'
import { body, handle } from '@/lib/route'

const Body = z.object({ lang: z.enum(['en', 'id']) })

// Feedback for one essay. The LLM is used only when the learner (or guardian) consented to AI feedback and
// the token budget allows; otherwise rule-based feedback from the model's own evidence. Either way it is saved.
export function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const me = await apiMe()
    const id = (await params).id
    if (!UUID.test(id)) throw new HttpError(400, 'bad_request')
    const { lang } = await body(req, Body)
    await rateLimit(me, 'feedback', 12, 600)
    const [e] = await asUser(me, tx => tx`
      select e.body, p.body as prompt, s.tr, s.cc, s.lr, s.gra, s.overall, s.drivers, s.flags, alt.ai_allowed(e.id) as ai
      from alt.essays e join alt.prompts p on p.id = e.prompt_id
      join alt.essay_scores s on s.essay_id = e.id and s.valid_to is null where e.id = ${id}`)
    if (!e) throw new HttpError(404, 'not_found', 'Essay not found or not scored yet.')
    if (!e.body) throw new HttpError(410, 'purged', 'The essay text was deleted under the retention policy.')
    const score = { tr: Number(e.tr), cc: Number(e.cc), lr: Number(e.lr), gra: Number(e.gra), overall: Number(e.overall), drivers: e.drivers, flags: e.flags }
    let source: 'llm' | 'rules' = 'rules'
    let dropped = 0
    let reason = e.ai ? null : 'no_consent'
    let fb = null
    if (e.ai && (await llmBudget(me))) {
      const r = await llmFeedback(e.prompt, e.body, score, lang)
      dropped = r.dropped
      await asUser(me, tx => tx`select alt.log_llm('essay_feedback', ${llmModel()}, ${r.sha || 'none'}, ${r.ms}, ${Boolean(r.feedback)}, ${r.dropped})`)
      if (r.feedback) { fb = r.feedback; source = 'llm' } else reason = 'llm_unavailable_or_ungrounded'
    } else if (e.ai) reason = 'budget'
    if (!fb) fb = rulesFeedback(e.body, score, lang)
    await asUser(me, tx => tx`select alt.save_feedback(${id}::uuid, ${lang}, ${source}, ${source === 'llm' ? llmModel() : null}, ${JSON.stringify(fb)}::text::jsonb, ${dropped})`)
    return Response.json({ source, dropped, reason, feedback: fb })
  })
}
