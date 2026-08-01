'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import type { CreateKeyInput } from '@/lib/schemas'

import type { Provider } from '@/types/domain'

type ApiError = { error: string; code?: string }

/**
 * Add, replace, and remove a provider key.
 *
 * `isPending` exists so a button cannot be pressed twice during a request —
 * submitting a key twice would run two probes and two writes for one intent.
 *
 * The refresh is `router.refresh()`, never `revalidatePath()`. Every route here
 * reads cookies and is therefore dynamic, so there is no Full Route Cache entry
 * to invalidate; what actually re-runs the page's `listProviderKeys()` is the
 * client asking for a fresh render. Established at F07 and re-tested at F11.
 */
export function useKeyMutation() {
  const router = useRouter()
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function saveKey(input: CreateKeyInput): Promise<boolean> {
    setIsPending(true)
    setError(null)

    try {
      const response = await fetch('/api/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })

      if (!response.ok) {
        const body = (await response.json()) as ApiError
        // The server's message is already written for a person and already
        // names the provider — both refusals say something specific and
        // actionable, so there is nothing to translate here.
        setError(body.error)
        return false
      }

      router.refresh()
      return true
    } catch {
      // Network failure only. An HTTP error took the branch above.
      setError('Network error. Nothing was saved — please try again.')
      return false
    } finally {
      setIsPending(false)
    }
  }

  async function removeKey(provider: Provider): Promise<boolean> {
    setIsPending(true)
    setError(null)

    try {
      const response = await fetch(`/api/keys?provider=${provider}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const body = (await response.json()) as ApiError
        setError(body.error)
        return false
      }

      router.refresh()
      return true
    } catch {
      setError('Network error. The key was not removed — please try again.')
      return false
    } finally {
      setIsPending(false)
    }
  }

  return { saveKey, removeKey, isPending, error, clearError: () => setError(null) }
}
