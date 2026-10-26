import 'server-only'
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { asApi } from './db'
import { apiError, HttpError } from './auth'

// Partner API (the prep platform pushing practice results and essays, pulling readiness):
//   Authorization: Bearer <api key>                 -> looked up by SHA-256 only; the key itself is never stored
//   Altimeter-Signature: t=<unix>,v1=<hex>          -> HMAC-SHA256(key, `${t}.${raw body}`), 5-minute window (POST)
//   Idempotency-Key: <unique per logical request>   -> retries replay the stored response, never a double write (POST)
// Every call is rate limited per key in Postgres, so the limit holds across serverless instances.

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

type Ctx = { keySha: string; raw: string; json: unknown }

export function apiRoute(opts: { write: boolean }, fn: (ctx: Ctx) => Promise<{ status?: number; body: unknown }>) {
  return async (req: Request) => {
    try {
      const key = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
      if (!/^alt_[a-z]+_[A-Za-z0-9_-]{20,}$/.test(key)) throw new HttpError(401, 'invalid_api_key', 'Missing or malformed API key.')
      const keySha = sha256(key)
      const [rl] = await asApi(tx => tx`select alt.hit(${'api:' + keySha}, 120, 60) as ok`)
      if (!rl.ok) throw new HttpError(429, 'rate_limited', '120 requests per minute per key.')
      const raw = opts.write ? await req.text() : ''
      if (!opts.write) {
        await asApi(tx => tx`select alt.api_inst(${keySha})`)
        const out = await fn({ keySha, raw, json: null })
        return Response.json(out.body, { status: out.status ?? 200, headers: { 'cache-control': 'no-store' } })
      }
      verifySignature(req.headers.get('altimeter-signature'), key, raw)
      const idem = req.headers.get('idempotency-key')
      if (!idem || idem.length > 100) throw new HttpError(400, 'idempotency_key_required', 'Send an Idempotency-Key header (max 100 chars).')
      const reqSha = sha256(raw)
      const [prev] = await asApi(tx => tx`select alt.api_idem_get(${keySha}, ${idem}) as r`)
      if (prev?.r) {
        if (prev.r.request_sha256 !== reqSha) throw new HttpError(422, 'idempotency_key_reused', 'This Idempotency-Key was used with a different body.')
        return Response.json(prev.r.response, { status: prev.r.status, headers: { 'idempotent-replayed': 'true' } })
      }
      let json: unknown
      try { json = JSON.parse(raw) } catch { throw new HttpError(400, 'bad_request', 'Body must be JSON.') }
      const out = await fn({ keySha, raw, json })
      await asApi(tx => tx`select alt.api_idem_put(${keySha}, ${idem}, ${reqSha}, ${out.status ?? 200}, ${JSON.stringify(out.body)}::text::jsonb)`)
      return Response.json(out.body, { status: out.status ?? 200 })
    } catch (e) {
      return apiError(e)
    }
  }
}

export function verifySignature(header: string | null, key: string, raw: string) {
  const m = /t=(\d+),\s*v1=([0-9a-f]{64})/.exec(header ?? '')
  if (!m) throw new HttpError(401, 'signature_required', 'Send Altimeter-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256>.')
  const t = Number(m[1])
  if (Math.abs(Date.now() / 1000 - t) > 300) throw new HttpError(401, 'signature_expired', 'Signature timestamp outside the 5-minute window.')
  const want = createHmac('sha256', key).update(`${t}.${raw}`).digest()
  const got = Buffer.from(m[2], 'hex')
  if (got.length !== want.length || !timingSafeEqual(got, want)) throw new HttpError(401, 'signature_invalid', 'Signature does not match the body.')
}

export function sign(key: string, raw: string, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${createHmac('sha256', key).update(`${t}.${raw}`).digest('hex')}`
}
