import { createBrowserClient } from '@supabase/ssr'

import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '@/lib/constants'

import type { Database } from '@/types/database'

/**
 * The browser client. Its only jobs in this project are starting the OAuth
 * redirect and, later, realtime — every read of user data happens on the
 * server, where RLS is applied to a cookie-bound session.
 *
 * It writes the PKCE code verifier to a cookie rather than localStorage, which
 * is what lets /auth/callback complete the exchange server-side.
 */
export function createBrowserSupabaseClient() {
  return createBrowserClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)
}
