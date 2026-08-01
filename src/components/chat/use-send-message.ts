'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import type { Provider } from '@/types/domain'

type SendInput = {
  /** Null starts a new conversation; the server creates it and returns the id. */
  conversationId: string | null
  text: string
  provider: Provider
  modelId: string
}

type SendResult = {
  send: (input: SendInput) => Promise<boolean>
  isPending: boolean
  error: string | null
}

/**
 * Posts a message and moves the app to wherever it now belongs.
 *
 * Returns false rather than throwing on failure, so the composer can keep the
 * text the person typed. Losing a paragraph to a 500 is worse than the 500.
 *
 * `router.refresh()` on every success is not optional. Next preserves a layout
 * across navigation, and feature 06 put the conversation query in the layout —
 * so without it a brand-new conversation never appears in the sidebar, and an
 * existing one never moves to the top.
 */
export function useSendMessage(): SendResult {
  const router = useRouter()
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function send(input: SendInput): Promise<boolean> {
    setIsPending(true)
    setError(null)

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Shaped like an AI SDK UIMessage from the start, so feature 08's
        // transport can take this over without the route's schema moving.
        body: JSON.stringify({
          conversationId: input.conversationId,
          message: {
            id: crypto.randomUUID(),
            role: 'user',
            parts: [{ type: 'text', text: input.text }],
          },
          provider: input.provider,
          modelId: input.modelId,
        }),
      })

      if (!response.ok) {
        const body = (await response.json()) as { error: string }
        setError(body.error)
        return false
      }

      const { conversationId } = (await response.json()) as { conversationId: string }

      if (input.conversationId === null) {
        router.push(`/chat/${conversationId}`)
      }

      router.refresh()
      return true
    } catch {
      // Only network failure reaches here. An HTTP error is handled above.
      setError('Network error. Please try again.')
      return false
    } finally {
      setIsPending(false)
    }
  }

  return { send, isPending, error }
}
