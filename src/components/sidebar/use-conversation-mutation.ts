'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type ApiError = { error: string; code?: string }

/**
 * Renames a conversation, or pins and unpins it. (F21)
 *
 * A sibling of `use-model-mutation.ts` rather than an extension of it. The two
 * share a fetch/refresh/error shape but nothing that decides anything: the
 * columns differ, and so does the error copy, which has to name what did not
 * happen. That makes this a second fetch wrapper, not a second copy of a rule —
 * the F15 one-definition argument applies to rules, and this is not one.
 *
 * Neither call updates anything optimistically, and both have to end in
 * `router.refresh()` rather than choosing to: a rename changes the row's
 * `aria-label`s and a pin moves the row into a different `<ul>` entirely, which
 * only a server re-render can do. `router.refresh()` and never
 * `revalidatePath()`, for the reason established at F07 and re-tested at F11 —
 * every route here reads cookies and is therefore dynamic, so there is no Full
 * Route Cache entry to invalidate.
 *
 * Both return a boolean rather than throwing. The caller is a menu item and an
 * input; neither has anywhere to put an exception.
 */
export function useConversationMutation() {
  const router = useRouter()
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function patch(
    conversationId: string,
    body: { title: string } | { pinned: boolean },
    networkError: string,
  ): Promise<boolean> {
    setIsPending(true)
    setError(null)

    try {
      const response = await fetch(`/api/conversations/${conversationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const payload = (await response.json()) as ApiError
        setError(payload.error)
        return false
      }

      router.refresh()
      return true
    } catch {
      // Network failure only. An HTTP error took the branch above.
      setError(networkError)
      return false
    } finally {
      setIsPending(false)
    }
  }

  /**
   * The title is sent as typed apart from a trim. The server trims too and its
   * copy is the authoritative one — this one only spares a round trip for a
   * title that is nothing but spaces.
   */
  async function rename(conversationId: string, title: string): Promise<boolean> {
    return patch(
      conversationId,
      { title: title.trim() },
      'Network error. The conversation was not renamed — please try again.',
    )
  }

  /** Desired state, not a toggle, so a double-click cannot undo itself. */
  async function setPinned(conversationId: string, pinned: boolean): Promise<boolean> {
    return patch(
      conversationId,
      { pinned },
      pinned
        ? 'Network error. The conversation was not pinned — please try again.'
        : 'Network error. The conversation was not unpinned — please try again.',
    )
  }

  return { rename, setPinned, isPending, error }
}
