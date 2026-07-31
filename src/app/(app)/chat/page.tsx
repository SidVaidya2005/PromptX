import { requireUser } from '@/server/auth'

import { Button } from '@/components/ui/button'

/**
 * TEMPORARY — feature 04's proof that the session survives a navigation.
 *
 * Feature 05 replaces this with the real workspace: the three-column shell and
 * its empty state, with sign-out moving into the sidebar footer where it
 * belongs. It exists now so the auth loop can actually be clicked end to end
 * rather than only asserted about.
 */
export default async function ChatPage() {
  const user = await requireUser()

  return (
    <main className="mx-auto flex max-w-180 flex-col gap-xl px-xl py-3xl">
      <h1 className="text-display-md text-ink">Signed in</h1>

      <p className="text-body-md text-body">
        This is a placeholder for the workspace. The session is live, which means
        the OAuth exchange, the cookie refresh, and the route guard are all
        working.
      </p>

      <dl className="flex flex-col gap-xs border-t border-hairline pt-lg">
        <dt className="text-caption text-mute">Signed in as</dt>
        <dd className="font-mono text-code text-body-strong">{user.email}</dd>
      </dl>

      {/* A plain form, so signing out needs no JavaScript and stays a POST. */}
      <form action="/auth/signout" method="post">
        <Button type="submit" variant="outline">
          Sign out
        </Button>
      </form>
    </main>
  )
}
