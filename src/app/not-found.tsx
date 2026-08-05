import Link from 'next/link'

import { Button } from '@/components/ui/button'

/**
 * The 404, at the root rather than inside the (app) group.
 *
 * That placement is forced: Next resolves a path matching no route against the
 * ROOT not-found, because there is no segment to locate a nearer one against. A
 * `(app)/not-found.tsx` would only ever fire for an explicit notFound() call
 * inside a route that already exists. So this page cannot render inside the
 * three-column shell, and pretending otherwise would mean adding a catch-all
 * route purely to fake it.
 *
 * It was added at feature 05 because the account menu then linked to a
 * /settings route nothing had built yet. That reason has expired — the menu
 * points at /settings/keys, which exists — but the page stays: any path
 * matching no route lands here, and the alternative is an unstyled framework
 * default.
 */
export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-180 flex-col items-start justify-center gap-lg px-xl py-3xl">
      <div className="flex flex-col gap-xs">
        <p className="font-mono text-code text-mute">404</p>

        <h1 className="text-display-md text-ink">This page does not exist</h1>

        <p className="text-body-md text-body">
          The link may be out of date, or the page may not have been built yet.
        </p>
      </div>

      <Button asChild variant="primary">
        <Link href="/chat">Back to PromptX</Link>
      </Button>
    </div>
  )
}
