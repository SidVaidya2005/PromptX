'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import type { UpdateConversationModelInput } from '@/lib/schemas'

type ApiError = { error: string; code?: string }

/**
 * Points a conversation at a different model.
 *
 * Only ever called with a conversation id. On `/chat` there is no row yet — the
 * conversation is created by the first send — so a model chosen there is local
 * state that rides along in the request body and is persisted by
 * `createConversation()`. Nothing here needs to know that; the caller simply
 * does not call it.
 *
 * The refresh is `router.refresh()`, never `revalidatePath()`, for the reason
 * established at F07 and re-tested at F11: every route here reads cookies and is
 * therefore dynamic, so there is no Full Route Cache entry to invalidate. What
 * re-runs the page's `getConversation()` is the client asking for a fresh render.
 */
export function useModelMutation() {
  const router = useRouter()
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function changeModel(
    conversationId: string,
    model: UpdateConversationModelInput,
  ): Promise<boolean> {
    setIsPending(true)
    setError(null)

    try {
      const response = await fetch(`/api/conversations/${conversationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(model),
      })

      if (!response.ok) {
        const body = (await response.json()) as ApiError
        setError(body.error)
        return false
      }

      router.refresh()
      return true
    } catch {
      // Network failure only. An HTTP error took the branch above.
      setError('Network error. The model was not changed — please try again.')
      return false
    } finally {
      setIsPending(false)
    }
  }

  return { changeModel, isPending, error }
}
