import { openapi } from '@/lib/openapi'

export function GET() {
  return Response.json(openapi, { headers: { 'cache-control': 'public, max-age=300' } })
}
