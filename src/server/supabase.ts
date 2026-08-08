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
 * The signed-out client, for `/share/[slug]` and nothing else. (F33)
 *
 * **This is weaker than the cookie-bound client, not stronger.** It carries the
 * same publishable key and no session at all, so PostgREST resolves the role to
 * `anon` and only the `anon` policies apply — which for this project means
 * exactly the three share policies: a conversation with a non-null `share_slug`,
 * its messages, and their attachment metadata. Nothing else in the schema has an
 * `anon` policy, so nothing else is reachable through it.
 *
 * **Why the cookie-bound client will not do**, which is the part worth reading
 * before anyone tries to simplify this away: F03's share policies are
 * `for select to anon`, and Postgres applies a policy only when the current role
 * matches. Supabase resolves a signed-in JWT to `authenticated`, so the
 * cookie-bound client returns **nothing** for a signed-in visitor opening
 * someone else's share link — which is the ordinary case, since a link is
 * usually passed between two people who both use the product. Reading through
 * this client makes every visitor identical.
 *
 * **And why the policies were not simply widened to `to anon, authenticated`:**
 * `listConversations()` carries no `user_id` filter on purpose, because RLS is
 * the boundary rather than the query. An `authenticated` policy of
 * `using (share_slug is not null)` would therefore put every shared conversation
 * in the system into every user's sidebar. The narrower client is the safe half
 * of that trade.
 *
 * No session handling, for the same reason the service-role client has none:
 * there is no user here to have one.
 */
export function createAnonSupabaseClient() {
  return createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
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
