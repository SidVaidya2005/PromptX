import { cookies } from 'next/headers'

import {
  ARCHIVED_COOKIE,
  COLLAPSED,
  RAIL_COOKIE,
  SHOW_ARCHIVED,
  SIDEBAR_COOKIE,
} from '@/lib/constants'
import { resolveDisplayName } from '@/lib/utils'

import { requireUser } from '@/server/auth'
import { listConversations } from '@/server/data/conversations'
import { getProfile } from '@/server/data/profiles'

import { TooltipProvider } from '@/components/ui/tooltip'
import { AppShell } from '@/components/shell/AppShell'
import { OutlineRail } from '@/components/shell/OutlineRail'
import { Sidebar } from '@/components/shell/Sidebar'
import { SearchShortcut } from '@/components/search/SearchShortcut'

import type { ShellUser } from '@/types/domain'

/**
 * The authenticated route group: its guard, and the frame everything renders
 * inside.
 *
 * requireUser() redirects to the landing page when there is no valid session,
 * which is what makes every route under (app) unreachable signed out. This is
 * one of the two places protection is enforced — each route handler checks
 * independently — and src/proxy.ts is neither of them.
 *
 * This file stays a Server Component, and the collapse cookies are read here
 * for that reason. localStorage cannot be read during a server render, so it
 * would force the sidebar to paint expanded and then snap shut after hydration
 * — on every navigation, for exactly the people who chose to close it.
 */
export default async function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const user = await requireUser()

  // Read before the query rather than beside it, because F22 made the query
  // depend on it: `includeArchived` decides which rows come back, so it has to
  // be known before the request is issued. This costs nothing — cookies() reads
  // the incoming request rather than going anywhere — and the two database
  // round trips below still overlap, which is what the original arrangement was
  // actually protecting.
  const cookieStore = await cookies()
  const showArchived = cookieStore.get(ARCHIVED_COOKIE)?.value === SHOW_ARCHIVED

  // Started here and deliberately NOT awaited. The sidebar awaits it inside a
  // Suspense boundary, so the three-column frame paints while the query is
  // still in flight — and the query itself is already running by then, rather
  // than starting once the shell has rendered. The fetch lives in this file
  // because nothing under src/components/ may import from src/server/.
  const conversations = listConversations(showArchived)

  const profile = await getProfile()

  // A missing profile row is recoverable. The handle_new_user trigger should
  // make it unreachable, but the session already carries an address, so there
  // is no reason for the whole workspace to fail over a display name.
  const shellUser: ShellUser = {
    displayName: resolveDisplayName(profile?.display_name, user.email ?? ''),
    email: profile?.email ?? user.email ?? '',
    avatarUrl: profile?.avatar_url ?? null,
  }

  return (
    // Belongs here rather than in the root layout: the landing page renders no
    // tooltips, and a provider there would ship to every signed-out visitor.
    <TooltipProvider>
      {/* Renders nothing; it exists here because this layout is the one
          component every authenticated route is inside. (F27) */}
      <SearchShortcut />

      <AppShell
        sidebar={
          <Sidebar
            user={shellUser}
            conversations={conversations}
            showArchived={showArchived}
          />
        }
        rail={<OutlineRail />}
        sidebarCollapsed={cookieStore.get(SIDEBAR_COOKIE)?.value === COLLAPSED}
        railCollapsed={cookieStore.get(RAIL_COOKIE)?.value === COLLAPSED}
      >
        {children}
      </AppShell>
    </TooltipProvider>
  )
}
