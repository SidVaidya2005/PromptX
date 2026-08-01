'use client'

import { useCallback, useMemo, useState } from 'react'
import { usePathname } from 'next/navigation'

import { ListIcon, MenuIcon } from 'lucide-react'

import {
  COLLAPSE_COOKIE_MAX_AGE,
  COLLAPSED,
  EXPANDED,
  RAIL_COOKIE,
  SIDEBAR_COOKIE,
} from '@/lib/constants'
import { cn } from '@/lib/utils'

import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { CollapseToggle } from '@/components/shell/CollapseToggle'
import { ShellContext, type ShellState } from '@/components/shell/use-shell'

type AppShellProps = {
  /** Server-rendered. Slotted, never constructed here. */
  sidebar: React.ReactNode
  rail: React.ReactNode
  children: React.ReactNode
  sidebarCollapsed: boolean
  railCollapsed: boolean
}

/**
 * The three-column frame, and the only stateful piece of the shell.
 *
 * `sidebar` and `rail` arrive as already-rendered Server Component nodes rather
 * than as components this file imports and calls. That is what keeps their
 * markup in the RSC payload instead of the client bundle — only this file's own
 * logic ships to the browser, and there is no CDN in front of the origin to
 * absorb anything heavier.
 *
 * Both collapse flags arrive from cookies read during the server render, so the
 * first paint is already correct. Toggling updates local state immediately and
 * writes the cookie for next time; there is no router.refresh(), because
 * nothing on the server needs to re-run to reflect a layout preference.
 */
export function AppShell({
  sidebar,
  rail,
  children,
  sidebarCollapsed: initialSidebarCollapsed,
  railCollapsed: initialRailCollapsed,
}: AppShellProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(initialSidebarCollapsed)
  const [railCollapsed, setRailCollapsed] = useState(initialRailCollapsed)

  // Below 1024px the columns are overlays instead, and the collapse preference
  // is ignored entirely. Closed on arrival, always.
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [railOpen, setRailOpen] = useState(false)

  const pathname = usePathname()
  const [lastPathname, setLastPathname] = useState(pathname)

  // An overlay that survives a navigation covers the page the user just asked
  // for. This is React's documented way to adjust state when a value changes —
  // set during render, not in an effect. An effect here would paint the stale
  // open drawer for a frame first, and the react-hooks/set-state-in-effect rule
  // rejects it outright.
  if (pathname !== lastPathname) {
    setLastPathname(pathname)
    setSidebarOpen(false)
    setRailOpen(false)
  }

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((collapsed) => {
      persistCollapse(SIDEBAR_COOKIE, !collapsed)
      return !collapsed
    })
  }, [])

  const toggleRail = useCallback(() => {
    setRailCollapsed((collapsed) => {
      persistCollapse(RAIL_COOKIE, !collapsed)
      return !collapsed
    })
  }, [])

  const shell = useMemo<ShellState>(
    () => ({ sidebarCollapsed, railCollapsed, toggleSidebar, toggleRail }),
    [sidebarCollapsed, railCollapsed, toggleSidebar, toggleRail],
  )

  return (
    <ShellContext.Provider value={shell}>
      <div className="flex h-dvh overflow-hidden bg-canvas">
        <aside
          aria-label="Conversation sidebar"
          className={cn(
            'hidden w-65 shrink-0 border-r border-hairline',
            !sidebarCollapsed && 'desktop:block',
          )}
        >
          {sidebar}
        </aside>

        {/* What a collapsed column leaves behind. A fully hidden one has no way
            back, and a floating restore button would sit on top of the thread
            once feature 09 fills it. */}
        <div
          className={cn(
            'hidden w-9 shrink-0 flex-col items-center border-r border-hairline pt-sm',
            sidebarCollapsed && 'desktop:flex',
          )}
        >
          <CollapseToggle column="sidebar" />
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* The only chrome the desktop shell does not have. DESIGN.md opens the
              outline "from the thread header", which does not exist until the
              thread does — feature 09 grows this into that header rather than
              inventing a second one. */}
          <header className="flex items-center justify-between gap-sm border-b border-hairline px-sm py-xs desktop:hidden">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Open the conversation sidebar"
              onClick={() => setSidebarOpen(true)}
            >
              <MenuIcon />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              aria-label="Open the outline"
              onClick={() => setRailOpen(true)}
            >
              <ListIcon />
            </Button>
          </header>

          {/* overflow-hidden, not auto: each page owns its own scrolling, which
              is what lets the composer stay pinned to the bottom of the thread
              column while the messages above it scroll. */}
          <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
        </div>

        <div
          className={cn(
            'hidden w-9 shrink-0 flex-col items-center border-l border-hairline pt-sm',
            railCollapsed && 'desktop:flex',
          )}
        >
          <CollapseToggle column="rail" />
        </div>

        <aside
          aria-label="Conversation outline"
          className={cn(
            'hidden w-55 shrink-0 border-l border-hairline',
            !railCollapsed && 'desktop:block',
          )}
        >
          {rail}
        </aside>

        {/* Radix mounts sheet content only while open, so the sidebar node above
            and the one below are never in the document at the same time. */}
        <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
          <SheetContent side="left" className="w-65">
            <SheetTitle className="sr-only">Conversation sidebar</SheetTitle>
            {sidebar}
          </SheetContent>
        </Sheet>

        <Sheet open={railOpen} onOpenChange={setRailOpen}>
          <SheetContent side="right" className="w-55">
            <SheetTitle className="sr-only">Conversation outline</SheetTitle>
            {rail}
          </SheetContent>
        </Sheet>
      </div>
    </ShellContext.Provider>
  )
}

/**
 * Written from the browser rather than through a route handler, because the
 * server never acts on this value — it only reads it back on the next render to
 * decide which markup to emit. SameSite=Lax is enough for a layout preference
 * and keeps it off cross-site requests.
 */
function persistCollapse(name: string, collapsed: boolean): void {
  const value = collapsed ? COLLAPSED : EXPANDED

  document.cookie = `${name}=${value};path=/;max-age=${COLLAPSE_COOKIE_MAX_AGE};samesite=lax`
}
