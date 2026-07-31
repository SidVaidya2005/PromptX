'use client'

import { useState } from 'react'

import { SITE_URL } from '@/lib/constants'
import { createBrowserSupabaseClient } from '@/lib/supabase-browser'

import { Button } from '@/components/ui/button'

type GoogleSignInButtonProps = {
  /** Where to land after the code exchange. Same-site paths only. */
  next?: string
}

/**
 * The only client component on the landing page.
 *
 * There is no Google "G" mark: the official one is four brand colours, and
 * DESIGN.md admits no chromatic accent. The off-white primary carries it.
 */
export function GoogleSignInButton({ next = '/chat' }: GoogleSignInButtonProps) {
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSignIn() {
    setIsPending(true)
    setError(null)

    const supabase = createBrowserSupabaseClient()

    const { error: signInError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${SITE_URL}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    })

    // On success the browser is already navigating away, so isPending is never
    // cleared — the button must stay disabled for the life of the redirect
    // rather than flicking back to enabled mid-navigation.
    if (signInError) {
      console.error('[landing] could not start Google sign-in', signInError)
      setError('Could not reach Google. Please try again.')
      setIsPending(false)
    }
  }

  return (
    <div className="flex flex-col items-start gap-sm">
      <Button variant="primary" onClick={handleSignIn} disabled={isPending}>
        {isPending ? 'Redirecting…' : 'Continue with Google'}
      </Button>

      {error ? (
        <p role="alert" className="text-body-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  )
}
