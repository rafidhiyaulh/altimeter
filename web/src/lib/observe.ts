import 'server-only'
import { after } from 'next/server'
import { asWorker } from './db'

// Request log for monitoring: route (ids collapsed), method, status and duration, written after the
// response is sent so it never slows a request down. Pollers are skipped so they do not drown the numbers.
const SKIP = new Set(['/api/ops/status', '/api/essays/:id/status'])

export function routeOf(url: string) {
  // any path segment with a digit is an id (uuid, number, external ref), except the API version
  return new URL(url).pathname.split('/').map(seg => /\d/.test(seg) && !/^v\d+$/.test(seg) ? ':id' : seg).join('/')
}

export function logRequest(req: Request, status: number, started: number) {
  const route = routeOf(req.url)
  if (SKIP.has(route)) return
  const ms = Date.now() - started
  try {
    after(() => asWorker(tx => tx`select alt.log_request(${route}, ${req.method}, ${status}, ${ms})`).catch(() => {}))
  } catch {
    // outside a request scope (tests): nothing to log
  }
}
