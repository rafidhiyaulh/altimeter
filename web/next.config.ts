import type { NextConfig } from 'next'

const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin : ''
const dev = process.env.NODE_ENV !== 'production'

// CSP: every source explicit. Inline scripts are needed by Next.js hydration; eval only in development.
// The browser only ever talks to this app and Supabase Auth.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' ${supabase}`.trim(),
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  ...(dev ? [] : ['upgrade-insecure-requests']),
].join('; ')

// Cache Components off on purpose: every page reads data as the signed-in user (row-level security per
// institution), so a shared cached render could leak one institution's learners to another.
const nextConfig: NextConfig = {
  cacheComponents: false,
  poweredByHeader: false,
  // Standalone build for self-hosting (web/Dockerfile); Vercel does not need it.
  output: process.env.BUILD_STANDALONE === '1' ? 'standalone' : undefined,
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        { key: 'Content-Security-Policy', value: csp },
      ],
    }]
  },
}

export default nextConfig
