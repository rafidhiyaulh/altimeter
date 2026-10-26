import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
vi.mock('../db', () => ({ asApi: vi.fn() }))
vi.mock('../auth', () => ({ apiError: vi.fn(), HttpError: class extends Error { constructor(public status: number, public code: string, m?: string) { super(m ?? code) } } }))
const { sign, verifySignature } = await import('../api')

describe('request signatures', () => {
  const key = 'alt_live_abcdefghijklmnopqrstuvwxyz012345'
  const body = JSON.stringify({ attempts: [{ student_ref: 'x', band: 6.5 }] })
  it('accepts a fresh signature over the exact body', () => {
    expect(() => verifySignature(sign(key, body), key, body)).not.toThrow()
  })
  it('rejects a changed body, a wrong key, an old timestamp and a missing header', () => {
    expect(() => verifySignature(sign(key, body), key, body.replace('6.5', '9'))).toThrow(/match/)
    expect(() => verifySignature(sign('alt_live_otherkeyotherkeyotherkey0000', body), key, body)).toThrow(/match/)
    expect(() => verifySignature(sign(key, body, Math.floor(Date.now() / 1000) - 3600), key, body)).toThrow(/window/)
    expect(() => verifySignature(null, key, body)).toThrow(/Signature/)
  })
})
