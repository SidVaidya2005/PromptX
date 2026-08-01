import { resolveDisplayName } from '@/lib/utils'

import { requireUser } from '@/server/auth'
import { getProfile } from '@/server/data/profiles'

import { Button } from '@/components/ui/button'

/**
 * The account page: profile details and sign-out.
 *
 * Built to the one line that specifies it — `project-overview.md`, "profile
 * details and sign-out". Deliberately read-only. The data model calls
 * `display_name` editable, but no feature specifies an edit path, so there is no
 * form and no mutation route here rather than an invented one.
 *
 * Sign-out posts to the existing `/auth/signout` handler, the same one the
 * sidebar account menu uses. A second mechanism for the same action would be two
 * things to keep correct.
 */
export default async function AccountPage() {
  const user = await requireUser()
  const profile = await getProfile()

  const displayName = resolveDisplayName(profile?.display_name, user.email ?? '')
  const email = profile?.email ?? user.email ?? ''

  return (
    <section>
      <h2 className="sr-only">Account</h2>

      <dl>
        <div className="flex flex-wrap items-baseline gap-x-lg gap-y-xxs border-b border-hairline py-lg">
          <dt className="w-30 shrink-0 text-body-sm text-mute">Name</dt>
          <dd className="min-w-0 flex-1 text-body-md text-ink">{displayName}</dd>
        </div>

        <div className="flex flex-wrap items-baseline gap-x-lg gap-y-xxs border-b border-hairline py-lg">
          <dt className="w-30 shrink-0 text-body-sm text-mute">Email</dt>
          <dd className="min-w-0 flex-1 break-all text-body-md text-ink">{email}</dd>
        </div>

        <div className="flex flex-wrap items-baseline gap-x-lg gap-y-xxs border-b border-hairline py-lg">
          <dt className="w-30 shrink-0 text-body-sm text-mute">Sign-in</dt>
          <dd className="min-w-0 flex-1 text-body-md text-ink">Google</dd>
        </div>
      </dl>

      <form action="/auth/signout" method="post" className="mt-xl">
        <Button type="submit" variant="outline">
          Sign out
        </Button>
      </form>
    </section>
  )
}
