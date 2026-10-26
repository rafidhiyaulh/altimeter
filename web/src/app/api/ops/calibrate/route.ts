import { after } from 'next/server'
import { apiMe } from '@/lib/auth'
import { asUser } from '@/lib/db'
import { buildCalibration, type CalPair } from '@/lib/calibration'
import { handle } from '@/lib/route'
import { kickWorkers } from '@/lib/worker'

// Learn the practice-to-official correction from every learner with an official result, save it as the
// active calibration, and recompute every forecast through the queue (fan-out to competing workers).
export function POST(req: Request) {
  return handle(async () => {
    const me = await apiMe(['platform'])
    const pairs = (await asUser(me, tx => tx`select student_id, skill, source, observed::float8, official::float8 from alt.calibration_pairs()`)) as unknown as CalPair[]
    const { entries, evaluation } = buildCalibration(pairs)
    const [r] = await asUser(me, tx => tx`select alt.save_calibration(${JSON.stringify(entries)}::text::jsonb, ${JSON.stringify({ pairs: pairs.length, by_source: evaluation })}::text::jsonb) as id`)
    after(() => kickWorkers(new URL(req.url).origin, 3, 'calibration'))
    return Response.json({ id: r.id, entries, evaluation, message: `Calibration #${r.id} active; every forecast is being recomputed.` })
  })
}
