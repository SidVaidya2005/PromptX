import 'server-only'

import { cookies } from 'next/headers'

import { createServerClient } from '@supabase/ssr'

import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '@/lib/constants'

import type { Database } from '@/types/database'

/**
 * The cookie-bound client. RLS applies to everything it touches, which is why
 * it is the default for all user data.
 *
 * A fresh client per call, never one held in module state: it closes over one
 * request's cookies, and a cached instance would serve one user's session to
 * the next request.
 *
 * The service-role client that bypasses RLS is deliberately absent. It arrives
 * with src/server/quota.ts, which is the only module permitted to construct one.
 */
export async function createServerSupabaseClient() {
  const cookieStore = await cookies()

  return createServerClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options)
          }
        } catch {
          // Called from a Server Component, where the cookie store is
          // read-only. Safe to swallow only because src/proxy.ts refreshes the
          // session on every request and writes the rotated cookies there.
        }
      },
    },
  })
}
