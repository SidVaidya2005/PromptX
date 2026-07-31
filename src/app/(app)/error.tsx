'use client'

import { useEffect } from 'react'

import { Button } from '@/components/ui/button'

type AppErrorProps = {
  error: Error & { digest?: string }
  reset: () => void
}

/**
 * The error boundary for the whole authenticated workspace.
 *
 * It sits inside the shell, so the sidebar and its navigation survive: one
 * failing panel costs the user the centre column, not the application. Next
 * requires this file to be a Client Component.
 *
 * The message is deliberately generic. `error.digest` is the only identifier
 * shown — in production Next replaces the real message with that digest before
 * it ever reaches the browser, and echoing a raw error would risk surfacing
 * database or provider detail to a user.
 */
export default function AppError({ error, reset }: AppErrorProps) {
  useEffect(() => {
    console.error('[app] route segment failed', error)
  }, [error])

  return (
    <div className="flex h-full items-center justify-center p-3xl">
      <div className="flex max-w-112 flex-col items-start gap-lg rounded-md border border-hairline bg-canvas-soft p-xl">
        <div className="flex flex-col gap-xs">
          <h1 className="text-display-sm text-ink">Something went wrong</h1>

          <p className="text-body-sm text-body">
            This part of the workspace failed to load. Your conversations are
            unaffected.
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
