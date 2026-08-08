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
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  /**
   * How many navigations this component has started and not yet seen land.
   *
   * **A count rather than a comparison, and the reason is that navigations land
   * out of order.** Two earlier designs compared the incoming `query` against
   * the value the debounce last sent, and both were measured failing:
   *
   * - Recording that value in *state* re-rendered before the navigation landed,
   *   so the comparison ran against a `query` prop that had not moved yet, read
   *   as an external change, and cleared the field. The typed word visibly
   *   vanished for about a second.
   * - Keying on the prop's own change fixed that, and still lost text whenever a
   *   navigation arrived after a later one had been recorded — type `deploy`,
   *   keep typing to `deployment`, and the slower `deploy` render lands holding
   *   a query that no longer matches anything remembered, so it looks external
   *   and overwrites four characters the user can see themselves having typed.
   *
   * Counting sidesteps the ordering entirely: every landing this component
   * caused consumes one outstanding navigation, whatever it happens to carry. A
   * change arriving while the count is zero is the only kind nobody here asked
   * for — a shared link, or the back button — and only that kind may touch the
   * draft.
   *
   * State rather than a ref, because a ref may be neither written nor read
   * during render; `react-hooks/refs` enforces that, correctly, since a ref
   * touched there misbehaves under a double invocation.
   */
  const [pendingNavigations, setPendingNavigations] = useState(0)
  const [previousQuery, setPreviousQuery] = useState(query)

  // Adjusting state when a prop changes, the pattern `AppShell` already uses for
  // an orphaned sheet: once per change of the prop, during render, so the field
  // never paints a stale frame.
  if (query !== previousQuery) {
    setPreviousQuery(query)

    if (pendingNavigations > 0) {
      // Ours. The draft is already at least this far ahead, and possibly
      // several keystrokes further.
      setPendingNavigations((pending) => pending - 1)
    } else {
      // Nobody here asked for this, so the URL is the authority: a shared link,
      // or a back navigation — including one back to a query this session
      // already sent, which a value comparison could not have recognised.
      setDraft(query)
    }
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

      const trimmed = next.trim()

      // Read from the live URL rather than from a captured prop, which would be
      // whatever it was when this keystroke happened. A navigation that changes
      // nothing renders nothing, so counting it would leave the tally
      // permanently high and swallow the next real back navigation.
      const current = new URLSearchParams(window.location.search).get('q')?.trim() ?? ''
      if (trimmed === current) return

      setPendingNavigations((pending) => pending + 1)

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
