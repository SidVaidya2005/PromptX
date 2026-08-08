'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import type { CreatePromptInput } from '@/lib/schemas'

import { invalidatePromptLibrary } from '@/components/prompts/use-prompt-library'

import type { Prompt } from '@/types/domain'

type ApiError = { error: string; code?: string }

/**
 * Creating, rewriting, and deleting a saved prompt. (F24)
 *
 * A sibling of `use-conversation-mutation.ts` and `use-key-mutation.ts` rather
 * than an abstraction over them: the three share a fetch/refresh/error shape and
 * nothing that decides anything, and the error copy has to name what did not
 * happen. The F15 one-definition rule is about rules, and a fetch wrapper is not
 * one.
 *
 * Every call ends in `router.refresh()` rather than updating anything
 * optimistically. The grid is rendered by a Server Component, so a re-render is
 * the only thing that can reorder it — and an edit does reorder it, because the
 * list is ordered on `updated_at`. `router.refresh()` and never
 * `revalidatePath()`, for the reason established at F07 and re-tested at F11:
 * every route here reads cookies and is therefore dynamic, so there is no Full
 * Route Cache entry to invalidate.
 *
 * `save` returns the row and `remove` returns a boolean; both return null/false
 * rather than throwing, because the callers are a dialog and a confirmation and
 * neither has anywhere to put an exception. A failure leaves the dialog open
 * with the typed prompt still in it — closing would be the one action that loses
 * it.
 */
export function usePromptMutation() {
  const router = useRouter()
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /**
   * Creates when `id` is null, rewrites when it is not.
   *
   * One function because the body is identical either way — `updatePromptSchema`
   * *is* `createPromptSchema`, for the reason recorded there — so splitting it
   * would be two spellings of one request that differ in a verb and a path.
   */
  async function save(id: string | null, input: CreatePromptInput): Promise<Prompt | null> {
    setIsPending(true)
    setError(null)

    try {
      const response = await fetch(id ? `/api/prompts/${id}` : '/api/prompts', {
        method: id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })

      if (!response.ok) {
        const payload = (await response.json()) as ApiError
        setError(payload.error)
        return null
      }

      const prompt = (await response.json()) as Prompt

      // The composer's picker caches the library for the page session, so its
      // copy is now stale by exactly this row. Dropped here rather than in each
      // caller because this hook wraps every write there is. (F25)
      invalidatePromptLibrary()

      router.refresh()
      return prompt
    } catch {
      // Network failure only. An HTTP error took the branch above.
      setError('Network error. The prompt was not saved — please try again.')
      return null
    } finally {
      setIsPending(false)
    }
  }

  async function remove(id: string): Promise<boolean> {
    setIsPending(true)
    setError(null)

    try {
      const response = await fetch(`/api/prompts/${id}`, { method: 'DELETE' })

      if (!response.ok) {
        const payload = (await response.json()) as ApiError
        setError(payload.error)
        return false
      }

      invalidatePromptLibrary()

      router.refresh()
      return true
    } catch {
      setError('Network error. The prompt was not deleted — please try again.')
      return false
    } finally {
      setIsPending(false)
    }
  }

  function clearError() {
    setError(null)
  }

  return { save, remove, isPending, error, clearError }
}
