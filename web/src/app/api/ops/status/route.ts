import { apiMe } from '@/lib/auth'
import { asUser } from '@/lib/db'
import { handle } from '@/lib/route'

// Live numbers for the System page: queue, latest batch progress, workers in the last 10 minutes.
export function GET(req: Request) {
  return handle(req, async () => {
    const me = await apiMe(['platform'])
    const [r] = await asUser(me, tx => tx`
      with lt as (select * from alt.load_tests order by id desc limit 1)
      select alt.q_stats() as queue,
        (select json_build_object('id', lt.id, 'n', lt.n, 'started_at', lt.started_at,
           'done', (select count(distinct s.essay_id) from alt.essay_scores s where s.valid_from >= lt.started_at),
           'last_at', (select max(s.valid_from) from alt.essay_scores s where s.valid_from >= lt.started_at),
           'workers', (select count(distinct s.scored_by) from alt.essay_scores s where s.valid_from >= lt.started_at)) from lt) as batch,
        (select count(*) from (select essay_id from alt.essay_scores where valid_to is null group by essay_id having count(*) > 1) x)::int as duplicate_current,
        (select json_agg(w) from (select worker, trigger, started_at, ended_at, processed, failed from alt.worker_runs where started_at > now() - interval '10 minutes' order by id desc limit 12) w) as runs`)
    return Response.json(r, { headers: { 'cache-control': 'no-store' } })
  })
}
