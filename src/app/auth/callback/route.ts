import { NextResponse } from 'next/server'

import { SITE_URL } from '@/lib/constants'
import { safeRedirectPath } from '@/lib/utils'

import { createServerSupabaseClient } from '@/server/supabase'

/** Where a new sign-in lands when the request carries no explicit destination. */
const DEFAULT_DESTINATION = '/chat'

/**
 * The OAuth code exchange. Google redirects here with a PKCE `code`, which is
 * traded for a session; @supabase/ssr writes the session cookies through the
 * server client's setAll.
 *
 * Every redirect is built from SITE_URL rather than the request's own origin.
 * Render terminates TLS at a proxy, so the origin seen here can be the internal
 * address rather than the one the browser knows — which produces a redirect
 * that drops the cookie it was supposed to deliver.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)

  // Google reports a cancelled or refused consent as ?error=access_denied.
  // Every failure reads the same to the user; the detail is logged, not shown.
  const oauthError = searchParams.get('error')
  const code = searchParams.get('code')

  if (oauthError || !code) {
    console.error('[auth/callback] no code returned', {
      error: oauthError ?? 'missing_code',
    })
    return NextResponse.redirect(`${SITE_URL}/?error=auth_failed`)
  }

  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    console.error('[auth/callback] code exchange failed', error)
    return NextResponse.redirect(`${SITE_URL}/?error=auth_failed`)
  }

  // Only a same-site path is honoured: this redirect carries a freshly minted
  // session, so an unchecked `next` would be an open redirect worth having.
  const destination = safeRedirectPath(searchParams.get('next'), DEFAULT_DESTINATION)

  return NextResponse.redirect(`${SITE_URL}${destination}`)
}
