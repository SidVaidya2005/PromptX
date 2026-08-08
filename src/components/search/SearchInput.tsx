'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import { SearchIcon } from 'lucide-react'

import { SEARCH_DEBOUNCE_MS } from '@/lib/constants'

import { Input } from '@/components/ui/input'

type SearchInputProps = {
  /** The query the current URL carries. This is the source of truth. */
  query: string
}

/**
 * The query field. (F27)
 *
 * **The URL is the state and this input is a view of it**, which is what makes
 * a result page linkable and the back button meaningful. Typing writes to the
 * URL after a pause; the page re-renders on the server with new results.
 *
 * `router.replace`, never `push`. Pushing every debounced keystroke turns Back
 * into a walk through `d`, `de`, `dep` — the classic version of this bug — and
 * leaves someone pressing it a dozen times to escape the page. Replacing keeps
 * the address shareable while Back still returns wherever they came from.
 *
 * The draft is local state rather than the prop, so the field never lags a
 * keystroke behind while a navigation is in flight. It is re-seeded when the
 * prop changes for a reason *other* than this component's own typing — arriving
 * on a shared link, or a back navigation — which is the `syncedQuery` check
 * below rather than an effect on `query` alone, since that would fight the
 * user's own input.
 */
export function SearchInput({ query }: SearchInputProps) {
  const router = useRouter()

  const [draft, setDraft] = useState(query)
  const [syncedQuery, setSyncedQuery] = useState(query)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // The URL changed underneath us — a shared link, or the back button. Adjusted
  // during render, React's documented alternative to an effect, so the field
  // never paints one frame holding the previous query.
  if (query !== syncedQuery) {
    setSyncedQuery(query)
    setDraft(query)
  }

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  function handleChange(next: string) {
    setDraft(next)

    if (timer.current) clearTimeout(timer.current)

    timer.current = setTimeout(() => {
      timer.current = null

      // Kept in step so the render-time sync above does not immediately undo
      // what this navigation is about to deliver.
      setSyncedQuery(next)

      const trimmed = next.trim()
      router.replace(trimmed === '' ? '/search' : `/search?q=${encodeURIComponent(trimmed)}`)
    }, SEARCH_DEBOUNCE_MS)
  }

  return (
    <div className="relative">
      <SearchIcon
        aria-hidden
        className="pointer-events-none absolute left-md top-1/2 size-4 -translate-y-1/2 text-mute"
      />

      <Input
        type="search"
        value={draft}
        onChange={(event) => handleChange(event.target.value)}
        // §27: focused on load. The page is a Server Component and this leaf is
        // not remounted per keystroke, so focus survives every navigation the
        // debounce makes.
        autoFocus
        placeholder="Search your messages"
        aria-label="Search your messages"
        autoComplete="off"
        className="h-11 pl-2xl text-body-md"
      />
    </div>
  )
}
