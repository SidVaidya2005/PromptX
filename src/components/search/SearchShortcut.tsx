'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/**
 * ⌘K — or Ctrl+K — from anywhere in the workspace. (F27)
 *
 * **It navigates to `/search` rather than opening a command palette.** A
 * palette would have to query from the browser, and `searchMessages()` is a
 * server module reached by a Server Component; there is no `GET /api/search`,
 * because F26 deliberately did not build one. So a palette would mean a new
 * endpoint plus a second copy of the results UI, to reach a page that already
 * exists and already focuses its input on load.
 *
 * **The listener is on `window` with `capture`, and that is the F21 finding
 * rather than a preference.** Radix dismisses its overlays from a
 * `document`-level capture listener, which runs before React's root listener;
 * anything hoping to see a key before a Radix layer does has to sit a step
 * higher in the capture path. Without it the shortcut would be swallowed
 * whenever a dialog or a popover happened to be open.
 *
 * Renders nothing. It exists in the `(app)` layout, which is the one component
 * every authenticated route is inside.
 */
export function SearchShortcut() {
  const router = useRouter()

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      // The modifier is what makes this safe to listen for globally: plain `k`
      // has to keep reaching the composer, so this fires only for the
      // deliberate chord. `metaKey` on macOS, `ctrlKey` everywhere else.
      if (event.key !== 'k' || !(event.metaKey || event.ctrlKey)) return

      // Chrome binds ⌘K to the address bar's search, so without this the
      // browser takes the keystroke and the app never sees it.
      event.preventDefault()

      router.push('/search')
    }

    window.addEventListener('keydown', handleKeyDown, { capture: true })

    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true })
    }
  }, [router])

  return null
}
