import { NextResponse, type NextRequest } from 'next/server'

import { createServerClient } from '@supabase/ssr'

import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '@/lib/constants'

/**
 * Session-cookie refresh, and nothing else.
 *
 * Next.js 16 renamed middleware.ts to proxy.ts and the export from `middleware`
 * to `proxy`; its runtime is always nodejs and cannot be configured. Every
 * Supabase SSR example still says "middleware" — only the names moved.
 *
 * This is NOT an authorisation check and must never become one. Route
 * protection lives in (app)/layout.tsx and in each route handler, both of which
 * call getUser() independently. A guard here would be the kind of single point
 * of failure the two-place rule in architecture.md exists to avoid.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet, headers) {
        // Rotated cookies are written onto the REQUEST as well as the response,
        // so a Server Component rendering later in this same request reads the
        // refreshed session rather than the one that just expired.
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value)
        }

        response = NextResponse.next({ request })

        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options)
        }

        for (const [key, value] of Object.entries(headers)) {
          response.headers.set(key, value)
        }
      },
    },
  })

  // Load-bearing, and nothing may be inserted between the client above and this
  // call. It is what rotates the token and triggers setAll; without it Server
  // Components start rendering a stale signed-out state and sessions end early.
  await supabase.auth.getUser()

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
