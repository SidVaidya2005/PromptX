'use client'

import { useRouter } from 'next/navigation'

import { ArchiveIcon } from 'lucide-react'

import { ARCHIVED_COOKIE, COLLAPSE_COOKIE_MAX_AGE, SHOW_ARCHIVED } from '@/lib/constants'
import { cn } from '@/lib/utils'

type ShowArchivedToggleProps = {
  /** Read from the cookie by the (app) layout, so the first paint is already right. */
  showArchived: boolean
}

/**
 * Reveals archived conversations in the sidebar, or puts them away again. (F22)
 *
 * The state is a cookie the `(app)` layout reads during its render, which is
 * what lets `listConversations(includeArchived)` ask the right question the
 * first time instead of the list correcting itself after hydration.
 *
 * **`router.refresh()` is not optional here, and this is the first cookie in the
 * app where that is true.** The collapse cookies decide markup that React state
 * already mirrors, so their server re-render is cosmetic and nothing calls
 * refresh. This one decides which rows the *query* returns, so without the
 * refresh the cookie changes, the button flips, and the list underneath keeps
 * answering the previous question until something else happens to re-render it.
 *
 * A button with `aria-pressed` rather than a switch: `code-standards.md` gates
 * new dependencies, and adding a primitive for a single two-state control is
 * exactly the kind of thing that gate exists to stop. `aria-pressed` is what
 * makes it a toggle to a screen reader rather than a command that fires twice.
 *
 * No `id` anywhere, and no `autoFocus` — below 1024px the sidebar is in the
 * document twice, so this button is too.
 */
export function ShowArchivedToggle({ showArchived }: ShowArchivedToggleProps) {
  const router = useRouter()

  function toggle() {
    // Cleared rather than set to a second value. Only SHOW_ARCHIVED is tested
    // for, so an expired cookie and a deliberately hidden one mean the same
    // thing, and the default falls on the side of not revealing anything.
    document.cookie = showArchived
      ? `${ARCHIVED_COOKIE}=;path=/;max-age=0;samesite=lax`
      : `${ARCHIVED_COOKIE}=${SHOW_ARCHIVED};path=/;max-age=${COLLAPSE_COOKIE_MAX_AGE};samesite=lax`

    router.refresh()
  }

  return (
    <button
      type="button"
      aria-pressed={showArchived}
      onClick={toggle}
      className={cn(
        'flex w-full items-center gap-sm rounded-sm px-md py-sm text-left text-body-sm',
        'transition-colors hover:bg-canvas-soft',
        // The 44px floor keys off pointer type, never off a breakpoint.
        'pointer-coarse:min-h-11',
        showArchived ? 'text-body-strong' : 'text-mute',
      )}
    >
      <ArchiveIcon aria-hidden className="size-3.5 shrink-0" />
      {showArchived ? 'Hide archived' : 'Show archived'}
    </button>
  )
}
