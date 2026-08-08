'use client'

import { useCallback, useState } from 'react'

import type { Prompt } from '@/types/domain'

/**
 * The library, read once per page session and shared by every picker. (F25)
 *
 * **Module state rather than component state, and that is the whole reason this
 * file exists.** `Chat` is remounted per conversation — `/chat/[id]` passes a
 * `key`, and Next remounts the segment on a param change anyway — so a cache
 * held in a hook's `useState` would be thrown away on every conversation
 * switch, and "fetched once per session" would quietly mean "fetched once per
 * conversation". A module outlives both.
 *
 * It is deliberately not a context provider. The only consumer is one control
 * inside the composer, and threading a provider through `AppShell` to reach it
 * would put the library's lifetime in the shell, where F18 already had to be
 * careful about state that outlives the route it belongs to.
 *
 * `promptsPromise` rather than a resolved array is what makes a concurrent
 * second open share the first open's request instead of starting another.
 */

let promptsPromise: Promise<Prompt[]> | null = null

/**
 * Throws away the cached library so the next open re-reads it. (F25)
 *
 * Called from `usePromptMutation` after every successful create, edit and
 * delete, which is the only way the set changes from inside this application.
 * Without it, saving a prompt on `/prompts` and switching to a chat tab shows a
 * picker that does not have it — the user's own change being invisible, which is
 * the worst form of staleness because there is nothing on screen to explain it.
 *
 * A different browser tab is not covered and deliberately so: the cost of
 * knowing would be a poll or a subscription for a panel that is opened rarely,
 * and the failure is a reload away.
 */
export function invalidatePromptLibrary(): void {
  promptsPromise = null
}

async function fetchPrompts(): Promise<Prompt[]> {
  const response = await fetch('/api/prompts')

  if (!response.ok) {
    // Cleared here rather than in the caller so a failed read is never the thing
    // that gets cached — otherwise one bad response would leave the picker empty
    // for the rest of the session with no way to retry but a reload.
    promptsPromise = null
    throw new Error('Failed to load prompts')
  }

  return (await response.json()) as Prompt[]
}

type PromptLibrary = {
  prompts: readonly Prompt[]
  isLoading: boolean
  error: string | null
  /** Idempotent: safe to call on every open, reads at most once per session. */
  load: () => void
}

export function usePromptLibrary(): PromptLibrary {
  const [prompts, setPrompts] = useState<readonly Prompt[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    // A component mounted after the fetch resolved still has an empty array of
    // its own, so this re-reads the settled promise rather than returning early
    // on `promptsPromise !== null`. The request is not repeated either way.
    const pending = promptsPromise ?? (promptsPromise = fetchPrompts())

    setError(null)
    setIsLoading(true)

    pending
      .then((loaded) => {
        setPrompts(loaded)
      })
      .catch(() => {
        setError('Could not load your prompts. Try again in a moment.')
      })
      .finally(() => {
        setIsLoading(false)
      })
  }, [])

  return { prompts, isLoading, error, load }
}
