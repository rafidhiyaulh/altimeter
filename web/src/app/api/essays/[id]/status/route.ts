import { apiMe, HttpError } from '@/lib/auth'
import { asUser } from '@/lib/db'
import { UUID } from '@/lib/guard'
import { handle } from '@/lib/route'

export function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(req, async () => {
    const me = await apiMe()
    const id = (await params).id
    if (!UUID.test(id)) throw new HttpError(400, 'bad_request')
    const [r] = await asUser(me, tx => tx`select status, overall from alt.v_essay_current where id = ${id}`)
    if (!r) throw new HttpError(404, 'not_found')
    return Response.json(r, { headers: { 'cache-control': 'no-store' } })
  })
}
