'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type ApiError = { error: string; code?: string }

/**
 * Publishes a conversation to a public link, or revokes it. (F33)
 *
 * A sibling of `use-conversation-mutation.ts` in the same fetch/refresh/error
 * shape, and a separate one for the reason that file records: they share a shape
 * but nothing that decides anything, and the error copy has to name what did not
 * happen.
 *
 * **Returns the slug rather than writing it anywhere**, so the caller owns the
 * state. The dialog needs the slug the instant it exists — to show the URL and
 * to enable the copy button — and routing that through a `router.refresh()` and
 * a server re-render would leave the dialog empty for a round trip after the
 * link had already been created.
 *
 * `router.refresh()` still runs, for the sidebar's "Shared" chip: that lives in
 * a Server Component in the `(app)` layout, which a client state change cannot
 * reach. The same split F22 recorded — this cookie-free mutation changes what a
 * server query returns, so the refresh is required rather than cosmetic.
 */
export function useShareMutation() {
  const router = useRouter()
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /**
   * Sets the desired state and returns the resulting slug, or undefined if the
   * request failed.
   *
   * Null and undefined mean different things here and the caller depends on it:
   * **null is a successful revoke**, undefined is "nothing changed, the error is
   * set". Collapsing them would make a failed publish look like a revoke and
   * clear a link that is still live.
   */
  async function setShared(
    conversationId: string,
    shared: boolean,
  ): Promise<string | null | undefined> {
    setIsSaving(true)
    setError(null)

    try {
      const response = await fetch(`/api/conversations/${conversationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shared }),
      })

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as ApiError | null
        setError(
          body?.error ??
            (shared ? 'Could not create the link.' : 'Could not revoke the link.'),
        )
        return undefined
      }

      const { shareSlug } = (await response.json()) as { shareSlug: string | null }

      // The chip in the sidebar is server-rendered, so only a refresh moves it.
      router.refresh()

      return shareSlug
    } catch (cause) {
      console.error('[chat] share change failed', cause)
      setError(shared ? 'Could not create the link.' : 'Could not revoke the link.')
      return undefined
    } finally {
      setIsSaving(false)
    }
  }

  return { setShared, isSaving, error }
}
