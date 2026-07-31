import { cookies } from 'next/headers'

import { COLLAPSED, RAIL_COOKIE, SIDEBAR_COOKIE } from '@/lib/constants'
import { resolveDisplayName } from '@/lib/utils'

import { requireUser } from '@/server/auth'
import { getProfile } from '@/server/data/profiles'

import { TooltipProvider } from '@/components/ui/tooltip'
import { AppShell } from '@/components/shell/AppShell'
import { OutlineRail } from '@/components/shell/OutlineRail'
import { Sidebar } from '@/components/shell/Sidebar'

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

  const [profile, cookieStore] = await Promise.all([getProfile(), cookies()])

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
      <AppShell
        sidebar={<Sidebar user={shellUser} />}
        rail={<OutlineRail />}
        sidebarCollapsed={cookieStore.get(SIDEBAR_COOKIE)?.value === COLLAPSED}
        railCollapsed={cookieStore.get(RAIL_COOKIE)?.value === COLLAPSED}
      >
        {children}
      </AppShell>
    </TooltipProvider>
  )
}
