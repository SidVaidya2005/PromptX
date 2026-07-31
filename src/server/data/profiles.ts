import 'server-only'

import { createServerSupabaseClient } from '@/server/supabase'

import type { Profile } from '@/types/domain'

/**
 * The caller's own profile row, or null when it does not exist.
 *
 * There is no `.eq('id', userId)` here on purpose. The owner-read RLS policy is
 * `(select auth.uid()) = id`, so the cookie-bound client can only ever see one
 * row — adding a filter would be harmless but would also make it look as though
 * the filter is what provides the isolation. It is not; the policy is.
 *
 * Null is a recoverable outcome rather than an error. The `handle_new_user`
 * trigger creates this row at signup so it should always be present, but a
 * shell that throws when a profile is missing fails harder than the situation
 * warrants — callers fall back to the address on the session.
 */
export async function getProfile(): Promise<Profile | null> {
  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase.from('profiles').select('*').maybeSingle()

  if (error) {
    console.error('[data/profiles] getProfile failed', error)
    throw new Error('Failed to load profile')
  }

  return data
}
