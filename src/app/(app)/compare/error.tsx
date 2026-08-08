'use client'

import { useEffect } from 'react'

import { Button } from '@/components/ui/button'

type CompareErrorProps = {
  error: Error & { digest?: string }
  reset: () => void
}

/**
 * The compare page's own boundary.
 *
 * The `(app)` boundary would catch this too; what a nested one adds is a
 * sentence naming what failed. Here that sentence is worth more than usual —
 * this page saves nothing, so the honest reassurance is not "your comparison is
 * safe" but "there was never anything to lose, and none of your conversations
 * are involved."
 *
 * Beyond that the message stays generic: in production Next replaces the real
 * message with `error.digest` before it reaches the browser, so the digest is
 * the only identifier there is to show.
 */
export default function CompareError({ error, reset }: CompareErrorProps) {
  useEffect(() => {
    console.error('[app/compare] segment failed', error)
  }, [error])

  return (
    <div className="flex h-full items-center justify-center p-3xl">
      <div className="flex max-w-112 flex-col items-start gap-lg rounded-md border border-hairline bg-canvas-soft p-xl">
        <div className="flex flex-col gap-xs">
          <h1 className="text-display-sm text-ink">Compare is unavailable</h1>

          <p className="text-body-sm text-body">
            Your conversations are unaffected. A comparison is never saved, so
            nothing was lost here — running it again is the whole recovery.
          </p>
        </div>

        <Button variant="primary" onClick={reset}>
          Try again
        </Button>

        {error.digest ? (
          <p className="font-mono text-code text-mute">Reference: {error.digest}</p>
        ) : null}
      </div>
    </div>
  )
}
