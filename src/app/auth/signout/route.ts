import { NextResponse } from 'next/server'

import { SITE_URL } from '@/lib/constants'

import { createServerSupabaseClient } from '@/server/supabase'

/**
 * POST only, deliberately. A GET sign-out can be fired by any prefetch, <img>
 * tag, or link a third party controls, which makes logging a user out a
 * one-pixel drive-by.
 *
 * 303 because the redirect follows a POST: it is the status that tells the
 * browser to issue a GET for the new location rather than repeating the POST.
 */
export async function POST() {
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.auth.signOut()

  // The session cookies are cleared either way, so there is nothing useful to
  // tell the user — send them to the landing page regardless.
  if (error) console.error('[auth/signout] sign out failed', error)

  return NextResponse.redirect(`${SITE_URL}/`, { status: 303 })
}
