'use client'

import { useState } from 'react'
import Link from 'next/link'

import type { ModelChoice } from '@/lib/compare'
import { willUseSharedKey } from '@/lib/models'
import { cn } from '@/lib/utils'

import { QuotaMeter } from '@/components/chat/QuotaMeter'
import { CompareColumn } from '@/components/compare/CompareColumn'
import { useCompareColumn } from '@/components/compare/use-compare-column'
import { Button } from '@/components/ui/button'

import type { Provider } from '@/types/domain'

type CompareProps = {
  configuredProviders: readonly Provider[]
  /** Shared-key messages left today, read on the server for this render. */
  remaining: number
  /** False while the global monthly ceiling is spent. */
  sharedKeyAvailable: boolean
  defaultLeft: ModelChoice
  defaultRight: ModelChoice
}

/**
 * One prompt, two models, side by side. (F31)
 *
 * **Nothing here is saved.** No conversation appears in the sidebar, the two
 * answers are gone the moment this page is left, and the route behind it imports
 * no data module at all. Feature 32 adds the way to keep one.
 *
 * The two columns are two independent requests, which is what makes an
 * independent stop control and a per-column error state possible at all — see
 * `src/app/api/compare/route.ts` for why the multiplexed single response §31
 * first described could give neither.
 *
 * **The send is never blocked on quota, unlike the composer's.** §31 is explicit
 * that one side may be refused while the other proceeds, and with two requests
 * that falls out for free: a spent allowance 429s the column it applies to and
 * says so there, while a column on the user's own key answers normally. Locking
 * the whole page would refuse the half that was going to work.
 */
export function Compare({
  configuredProviders,
  remaining,
  sharedKeyAvailable,
  defaultLeft,
  defaultRight,
}: CompareProps) {
  const [prompt, setPrompt] = useState('')

  const [leftModel, setLeftModel] = useState(defaultLeft)
  const [rightModel, setRightModel] = useState(defaultRight)

  /**
   * The question both columns are answering, held apart from the draft.
   *
   * Without it, editing the box after running would silently rewrite the
   * heading above two answers to a question they were never asked.
   */
  const [asked, setAsked] = useState<string | null>(null)

  const left = useCompareColumn('left', leftModel.provider, leftModel.modelId)
  const right = useCompareColumn('right', rightModel.provider, rightModel.modelId)

  const isStreaming = left.isStreaming || right.isStreaming

  // Whether the allowance is in play at all is per column, because the model is.
  // Either side being on the shared key is enough to make the count worth
  // showing; both being on it is what makes a comparison cost two.
  const sharedSides =
    Number(willUseSharedKey(leftModel.provider, leftModel.modelId, configuredProviders)) +
    Number(willUseSharedKey(rightModel.provider, rightModel.modelId, configuredProviders))

  const canRun = prompt.trim().length > 0 && !isStreaming

  function run() {
    if (!canRun) return

    const text = prompt.trim()
    setAsked(text)

    // Both in the same gesture, which is the entire reason the two hooks live in
    // this component rather than inside the columns.
    left.send(text)
    right.send(text)
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    // isComposing for the reason the composer records: while an IME candidate
    // window is open, Enter commits the candidate, and treating it as "run"
    // fires a half-typed prompt at two models.
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return

    event.preventDefault()
    run()
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-hairline px-lg py-lg tablet:px-xl">
        <div className="mx-auto flex w-full max-w-240 flex-col gap-sm">
          <div className="flex items-baseline justify-between gap-md">
            <h1 className="text-display-sm text-ink">Compare</h1>

            {/* Only while the shared key would answer one of the columns. A user
                on their own keys for both is not spending this allowance, so a
                count of it is noise. */}
            {sharedSides > 0 && sharedKeyAvailable && <QuotaMeter remaining={remaining} />}
          </div>

          {/* The breaker is global and nothing the user does changes it, so it is
              said once here rather than twice in the columns. Not a block: a
              column on a personal key is unaffected and must still run. */}
          {sharedSides > 0 && !sharedKeyAvailable && (
            <p role="status" className="text-body-sm text-danger">
              Shared access is temporarily unavailable, so a column on the shared
              model won&rsquo;t answer.{' '}
              <Link
                href="/settings/keys"
                className="underline underline-offset-2 hover:text-ink"
              >
                Add your own API key
              </Link>{' '}
              to compare anything else.
            </p>
          )}

          <form
            onSubmit={(event) => {
              event.preventDefault()
              run()
            }}
            className="flex flex-col gap-sm"
          >
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={handleKeyDown}
              rows={2}
              aria-label="Prompt to compare"
              placeholder="Ask both models the same thing"
              className={cn(
                // DESIGN.md `composer`: canvas-soft fill, hairline border,
                // rounded-md, and the border brightening on focus.
                'w-full resize-none rounded-md border border-hairline bg-canvas-soft',
                'px-md py-sm text-body-md text-ink outline-none transition-colors',
                'placeholder:text-mute focus:border-mute',
                // Arbitrary on purpose: the figure is viewport-relative and the
                // token scale is in px, so there is nothing here to reference.
                'max-h-[30dvh] overflow-y-auto',
              )}
            />

            <div className="flex items-center justify-between gap-md">
              {/* Said before the click rather than discovered after it. Two real
                  provider calls happen per comparison and both are billed; on
                  the shared key that is two of the daily twenty. */}
              <p className="text-caption text-mute">
                {sharedSides === 2
                  ? 'Runs both models — two of your free messages.'
                  : sharedSides === 1
                    ? 'Runs both models — one of your free messages.'
                    : 'Runs both models on your own keys.'}
              </p>

              <Button type="submit" variant="primary" size="sm" disabled={!canRun}>
                {isStreaming ? 'Running…' : 'Compare'}
              </Button>
            </div>
          </form>

          {asked && (
            <p className="text-body-sm text-body">
              <span className="text-mute">Asked:</span> {asked}
            </p>
          )}
        </div>
      </div>

      {/* Two equal columns with a hairline between them, per DESIGN.md, stacking
          below 1024px. `desktop:` is the only prefix that exists at that
          boundary — Tailwind's lg: is deleted from the theme and would silently
          generate nothing. */}
      <div className="grid min-h-0 flex-1 grid-cols-1 desktop:grid-cols-2">
        <CompareColumn
          isFirst
          provider={leftModel.provider}
          modelId={leftModel.modelId}
          configuredProviders={configuredProviders}
          column={left}
          hasRun={asked !== null}
          onSelectModel={(provider, modelId) => setLeftModel({ provider, modelId })}
        />

        <CompareColumn
          isFirst={false}
          provider={rightModel.provider}
          modelId={rightModel.modelId}
          configuredProviders={configuredProviders}
          column={right}
          hasRun={asked !== null}
          onSelectModel={(provider, modelId) => setRightModel({ provider, modelId })}
        />
      </div>
    </div>
  )
}
