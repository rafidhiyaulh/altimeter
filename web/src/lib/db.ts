import 'server-only'
import postgres from 'postgres'

// One small pool per server instance, through Supabase's transaction pooler (so no prepared statements).
// The login role `alt_app` owns nothing: every query runs inside a transaction that first switches to
// `alt_user` (row-level security on the verified JWT claims), `alt_worker` (queue functions only) or
// `alt_api` (partner API functions only).
const globalForSql = globalThis as unknown as { altSql?: postgres.Sql }
export const sql =
  globalForSql.altSql ??
  postgres(process.env.DATABASE_URL!, {
    prepare: false,
    max: 4,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => {},
    types: { bigint: postgres.BigInt },
    transform: { value: { from: (v: unknown) => (typeof v === 'bigint' ? Number(v) : v) } },
  })
if (process.env.NODE_ENV !== 'production') globalForSql.altSql = sql

export type Tx = postgres.TransactionSql
export type Claims = { sub: string; email?: string }

export function asUser<T>(claims: Claims, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sql.begin(async tx => {
    const jwt = JSON.stringify({ sub: claims.sub, email: claims.email ?? null, role: 'authenticated' })
    await tx`select set_config('request.jwt.claims', ${jwt}, true), set_config('search_path', 'alt, public', true)`
    await tx`set local role alt_user`
    return fn(tx)
  }) as Promise<T>
}

export function asWorker<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sql.begin(async tx => {
    await tx`select set_config('search_path', 'alt, public', true)`
    await tx`set local role alt_worker`
    return fn(tx)
  }) as Promise<T>
}

export function asApi<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sql.begin(async tx => {
    await tx`select set_config('search_path', 'alt, public', true)`
    await tx`set local role alt_api`
    return fn(tx)
  }) as Promise<T>
}

// numeric columns arrive as strings from postgres.js
export const n = (v: unknown): number | null => (v == null ? null : Number(v))
