import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { apiMe } from '@/lib/auth'
import { asUser } from '@/lib/db'
import { sha256 } from '@/lib/api'
import { body, handle } from '@/lib/route'

const Body = z.object({ institution_id: z.number().int(), label: z.string().min(1).max(60) })

// The key is shown exactly once; only its SHA-256 and an 8-character prefix are stored.
export function POST(req: Request) {
  return handle(async () => {
    const me = await apiMe(['platform', 'inst_admin'])
    const b = await body(req, Body)
    const prefix = randomBytes(4).toString('hex')
    const key = `alt_live_${prefix}${randomBytes(24).toString('base64url')}`
    const [r] = await asUser(me, tx => tx`select alt.create_api_key(${b.institution_id}::smallint, ${b.label}, ${prefix}, ${sha256(key)}) as id`)
    return Response.json({ id: r.id, key, message: 'Copy the key now; it will not be shown again.' })
  })
}
