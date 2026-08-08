'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { requestTitle } from '@/components/chat/request-title'

import type { Provider } from '@/types/domain'

type ApiError = { error: string; code?: string }

export type PromoteInput = {
  prompt: string
  answer: string
  provider: Provider
  modelId: string
}

/**
 * Turns one column of a comparison into a conversation and goes there. (F32)
 *
 * A sibling of the other `use-*-mutation` hooks in the same fetch/refresh/error
 * shape, with one thing none of them has: this navigates. That is what makes the
 * ordering below worth writing down rather than reading as boilerplate.
 *
 * **The two refreshes are the same pair `Chat` performs for a conversation it
 * created**, and for the same reason. Next preserves a layout across a
 * client-side navigation, and the sidebar's conversation query lives in the
 * `(app)` layout — so without the first `router.refresh()` the promoted
 * conversation never appears in the list at all. The second lands the generated
 * title a moment later, and is skipped when nothing was written.
 *
 * The title request is deliberately not awaited before navigating.
 * `TITLE_TIMEOUT_MS` is fifteen seconds, and holding someone on the compare page
 * that long for six words nobody is waiting on would be the feature feeling
 * broken. `fetch` is not cancelled by React unmounting the caller, so it
 * completes regardless of this component going away with the navigation.
 */
export function usePromoteComparison() {
  const router = useRouter()
  const [isPromoting, setIsPromoting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function promote(input: PromoteInput): Promise<boolean> {
    setIsPromoting(true)
    setError(null)

    try {
      const response = await fetch('/api/compare/promote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as ApiError | null
        setError(body?.error ?? 'Could not continue this comparison.')
        setIsPromoting(false)
        return false
      }

      const { conversationId } = (await response.json()) as { conversationId: string }

      // `push` rather than `replace`: the comparison is a real place the user
      // came from, and Back should return them to it. The other column's answer
      // is gone either way — nothing was persisted — but the prompt and the
      // pickers are where they left them.
      router.push(`/chat/${conversationId}`)
      router.refresh()

      void requestTitle(conversationId).then((named) => {
        if (named) router.refresh()
      })

      // `isPromoting` is deliberately left true here, and ONLY here. The
      // navigation is in flight and this component is about to unmount, so
      // clearing it would flash the button back to its idle label for the frame
      // before that happens.
      //
      // Which is why there is no `finally`: it would run on this path too and
      // undo exactly that. Every path that stays on the page clears the flag
      // itself — miss one and the button is disabled for the rest of the session
      // with nothing on screen to explain why.
      return true
    } catch (cause) {
      console.error('[compare] promote failed', cause)
      setError('Could not continue this comparison.')
      setIsPromoting(false)
      return false
    }
  }

  return { promote, isPromoting, error }
}
