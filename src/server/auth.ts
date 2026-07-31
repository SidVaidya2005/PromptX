import 'server-only'

import { redirect } from 'next/navigation'

import type { User } from '@supabase/supabase-js'

import { createServerSupabaseClient } from '@/server/supabase'

/**
 * Both helpers use auth.getUser(), which validates the JWT against the auth
 * server. auth.getSession() reads cookie data a client could have forged and
 * must never gate access to anything — it does not appear in this codebase.
 */

/** The signed-in user, or a redirect to the landing page. For Server Components. */
export async function requireUser(): Promise<User> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.auth.getUser()

  if (error || !data.user) redirect('/')

  return data.user
}

/** The signed-in user, or null. For route handlers, which answer 401 themselves. */
export async function getUser(): Promise<User | null> {
  const supabase = await createServerSupabaseClient()
  const { data } = await supabase.auth.getUser()

  return data.user ?? null
}
