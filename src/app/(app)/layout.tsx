import { requireUser } from '@/server/auth'

/**
 * The authenticated route group's guard.
 *
 * requireUser() redirects to the landing page when there is no valid session,
 * which is what makes every route under (app) unreachable signed out. This is
 * one of the two places protection is enforced — each route handler checks
 * independently — and src/proxy.ts is neither of them.
 *
 * The frame itself is feature 05's. This layout is deliberately a bare wrapper
 * until then; the sidebar, thread column, and outline rail replace this markup
 * wholesale.
 */
export default async function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  await requireUser()

  return <div className="min-h-screen bg-canvas">{children}</div>
}
