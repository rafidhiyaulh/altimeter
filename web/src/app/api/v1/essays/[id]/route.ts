import { asApi } from '@/lib/db'
import { apiRoute } from '@/lib/api'
import { HttpError } from '@/lib/auth'
import { UUID } from '@/lib/guard'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id
  return apiRoute({ write: false }, async ({ keySha }) => {
    if (!UUID.test(id)) throw new HttpError(400, 'bad_request', 'id must be a UUID')
    const [r] = await asApi(tx => tx`select alt.api_essay(${keySha}, ${id}::uuid) as e`)
    if (!r?.e) throw new HttpError(404, 'not_found', 'No such essay for this institution.')
    return { body: r.e }
  })(req)
}
