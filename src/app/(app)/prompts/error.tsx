'use client'

import { useEffect } from 'react'

import { Button } from '@/components/ui/button'

type PromptsErrorProps = {
  error: Error & { digest?: string }
  reset: () => void
}

/**
 * The library's own boundary, which `code-standards.md` names `/prompts` as
 * needing alongside its skeleton.
 *
 * The `(app)` boundary would already catch this — what a nested one adds is a
 * sentence that names what failed, so a reader is not left wondering whether
 * their conversations went with it. The message stays generic beyond that:
 * `error.digest` is the only identifier shown, because in production Next
 * replaces the real message with that digest before it reaches the browser.
 */
export default function PromptsError({ error, reset }: PromptsErrorProps) {
  useEffect(() => {
    console.error('[app/prompts] segment failed', error)
  }, [error])

  return (
    <div className="flex h-full items-center justify-center p-3xl">
      <div className="flex max-w-112 flex-col items-start gap-lg rounded-md border border-hairline bg-canvas-soft p-xl">
        <div className="flex flex-col gap-xs">
          <h1 className="text-display-sm text-ink">Could not load your prompts</h1>

          <p className="text-body-sm text-body">
            Nothing has been lost — the library failed to load, not to save.
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
