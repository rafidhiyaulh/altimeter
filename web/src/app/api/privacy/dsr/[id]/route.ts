import { apiMe, HttpError } from '@/lib/auth'
import { asUser } from '@/lib/db'
import { handle } from '@/lib/route'

// Complete a request. Export returns the JSON document as a download; erase returns what was kept.
export function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(req, async () => {
    const me = await apiMe(['inst_admin', 'platform'])
    const id = Number((await params).id)
    if (!Number.isInteger(id)) throw new HttpError(400, 'bad_request')
    const [r] = await asUser(me, tx => tx`select alt.complete_dsr(${id}) as out`)
    if (r.out?.erased) return Response.json({ message: 'Erased: text and identity removed, band scores kept under a pseudonym.' })
    return new Response(JSON.stringify(r.out, null, 2), {
      headers: { 'content-type': 'application/json', 'content-disposition': `attachment; filename="altimeter-export-${id}.json"`, 'cache-control': 'no-store' },
    })
  })
}
