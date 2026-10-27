import { asApi } from '@/lib/db'
import { apiRoute } from '@/lib/api'
import { HttpError } from '@/lib/auth'

export async function GET(req: Request, { params }: { params: Promise<{ ref: string }> }) {
  const ref = decodeURIComponent((await params).ref)
  return apiRoute({ write: false }, async ({ keySha }) => {
    const [r] = await asApi(tx => tx`select alt.api_readiness(${keySha}, ${ref}) as r`)
    if (!r?.r) throw new HttpError(404, 'not_found', 'No such learner for this institution.')
    return { body: r.r }
  })(req)
}
