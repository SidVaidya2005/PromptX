import 'server-only'

import { cookies } from 'next/headers'

import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'

import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '@/lib/constants'

import { serverEnv } from '@/server/env'

import type { Database } from '@/types/database'

/**
 * The cookie-bound client. RLS applies to everything it touches, which is why
 * it is the default for all user data.
 *
 * A fresh client per call, never one held in module state: it closes over one
 * request's cookies, and a cached instance would serve one user's session to
 * the next request.
 *
 * The service-role client below bypasses RLS entirely, and only
 * src/server/quota.ts may construct one.
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

/**
 * Bypasses RLS. Permitted ONLY in src/server/quota.ts, for shared_key_budget.
 * Every other call site is a bug.
 *
 * That table is a global operational counter with no owner, so there is no
 * auth.uid() to scope a policy to — it has RLS enabled and no policy for any
 * role, which makes it unreachable through the publishable key by construction.
 * This client is the only way in, which is precisely why its blast radius is
 * kept to one module: a secret key assumes `service_role` and can read every
 * row of every table, including other people's conversations and the ciphertext
 * of their API keys.
 *
 * No session handling, because there is no user here to have one. Left on, the
 * client would try to persist and refresh a session that does not exist.
 */
export function createServiceRoleClient() {
  return createClient<Database>(SUPABASE_URL, serverEnv.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
