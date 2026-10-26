import { apiMe, HttpError } from '@/lib/auth'
import { asUser } from '@/lib/db'
import { handle } from '@/lib/route'

export function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const me = await apiMe(['platform', 'inst_admin'])
    const id = Number((await params).id)
    if (!Number.isInteger(id)) throw new HttpError(400, 'bad_request')
    await asUser(me, tx => tx`select alt.revoke_api_key(${id})`)
    return Response.json({ message: 'Key revoked.' })
  })
}
