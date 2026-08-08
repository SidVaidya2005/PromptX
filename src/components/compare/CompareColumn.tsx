'use client'

import { SquareIcon } from 'lucide-react'

import { willUseSharedKey } from '@/lib/models'
import { cn } from '@/lib/utils'

import { CopyButton } from '@/components/chat/CopyButton'
import { MarkdownErrorBoundary } from '@/components/chat/MarkdownErrorBoundary'
import { MarkdownMessage } from '@/components/chat/MarkdownMessage'
import { ModelPicker } from '@/components/chat/ModelPicker'
import type { CompareColumnState } from '@/components/compare/use-compare-column'
import { Button } from '@/components/ui/button'

import type { Provider } from '@/types/domain'

type CompareColumnProps = {
  provider: Provider
  modelId: string
  configuredProviders: readonly Provider[]
  column: CompareColumnState
  /** True once a prompt has been sent, so an idle column can say what it is for. */
  hasRun: boolean
  /** The hairline between the columns hangs off the first one. */
  isFirst: boolean
  /** True while either column is being promoted, so neither offers a second click. */
  isPromoting: boolean
  /** Only ever set on the column whose promotion failed. */
  promoteError: string | null
  onSelectModel: (provider: Provider, modelId: string) => void
  /** Keeps this answer, as a conversation. Absent while there is nothing to keep. */
  onPromote: () => void
}

/**
 * One side of a comparison: which model, what it said, and a way to stop it.
 *
 * Presentational — `useCompareColumn` owns the stream, because both columns have
 * to be started by one gesture and something above them has to hold both.
 *
 * **Deliberately not `AssistantMessage`.** That component carries a regenerate
 * menu, an outline anchor and a jump highlight, none of which exist here: there
 * is no thread to navigate, no row to regenerate, and no search result that
 * could point at this. What it actually shares with a response in the thread is
 * the markdown rendering and the copy button, so those are what is reused.
 * DESIGN.md's `message-assistant` rule holds all the same — no fill and no
 * border on the answer itself; the hairline below belongs to the column.
 */
export function CompareColumn({
  provider,
  modelId,
  configuredProviders,
  column,
  hasRun,
  isFirst,
  isPromoting,
  promoteError,
  onSelectModel,
  onPromote,
}: CompareColumnProps) {
  // Which key answers is a property of the selected model, not of the user, so
  // it is read per column: someone with an OpenRouter key comparing it against
  // the shared Gemini is spending the allowance on one side only.
  const onSharedKey = willUseSharedKey(provider, modelId, configuredProviders)

  return (
    <section
      // Two equal columns with a hairline between them, per DESIGN.md. The
      // divider hangs off the first column and swaps edges at the breakpoint,
      // because below 1024px the columns stack and a vertical rule between them
      // would be drawn down the middle of nothing.
      className={cn(
        'flex min-h-0 min-w-0 flex-col',
        isFirst && 'border-b border-hairline desktop:border-b-0 desktop:border-r',
      )}
      aria-label={`${isFirst ? 'First' : 'Second'} model`}
    >
      <header className="flex items-center justify-between gap-sm border-b border-hairline px-lg py-sm">
        <div className="flex min-w-0 items-center gap-sm">
          <ModelPicker
            provider={provider}
            modelId={modelId}
            configuredProviders={configuredProviders}
            // Changing this column's model mid-stream cannot affect the request
            // already in flight, and offering it would imply otherwise. The
            // other column is untouched — it is a separate request with a
            // separate picker.
            disabled={column.isStreaming}
            onSelect={onSelectModel}
          />

          {/* Only while the shared key is what answers THIS column. Saying it on
              a column billed to the user's own key would be untrue. */}
          {onSharedKey && <span className="text-caption text-mute">Shared</span>}
        </div>

        {/* This column's own stop, which is the point of one request per column:
            aborting this fetch ends this provider call. Rendered only while it
            is live, matching the composer, rather than sitting there disabled. */}
        {column.isStreaming && (
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={column.stop}
            aria-label="Stop this model"
          >
            <SquareIcon />
          </Button>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-lg py-lg">
        {column.answer ? (
          <div className="group flex flex-col gap-sm">
            <MarkdownErrorBoundary content={column.answer}>
              <MarkdownMessage
                content={column.answer}
                isStreaming={column.isStreaming}
              />
            </MarkdownErrorBoundary>

            {/**
             * Below the answer, never instead of it.
             *
             * The first version rendered the error in place of the text, and a
             * generation that failed halfway would have thrown away everything
             * that had arrived — the failure `architecture.md` states as a rule
             * for the thread ("a stream that fails or aborts keeps whatever
             * partial content arrived") and that this view would quietly have
             * broken. Found by watching a real provider failure, not predicted.
             */}
            {column.error && (
              <p role="alert" className="text-body-sm text-danger">
                {column.error}
              </p>
            )}

            {/* DESIGN.md `message-meta`, and the coarse variant is not optional:
                without it a touch device loses the only way to take an answer
                out of a view that saves nothing. Not offered mid-stream —
                copying half an answer is rarely what anyone meant. */}
            {!column.isStreaming && (
              <div
                className={cn(
                  'flex items-center gap-md font-mono text-code text-mute',
                  'opacity-0 transition-opacity',
                  'group-focus-within:opacity-100 group-hover:opacity-100',
                  'pointer-coarse:opacity-100',
                )}
              >
                {/* The raw markdown, not the rendered text — pasting an answer
                    into an editor should give back its fences. */}
                <CopyButton value={column.answer} label="Copy this answer" />
              </div>
            )}

            {/**
             * The only way out of a view that saves nothing. (F32)
             *
             * Persistently visible rather than hover-revealed, unlike the copy
             * button above it: `DESIGN.md` forbids reaching a function by hover
             * alone, and this is the function of the whole page. A comparison
             * that cannot be kept was only ever a demonstration.
             *
             * Offered only on a settled column — `column.answer` is non-empty and
             * `isStreaming` is false — so there is always something to keep, and
             * an answer still arriving is never frozen halfway by a click.
             * Disabled while EITHER column is promoting, because the first click
             * is already navigating and a second would create a second
             * conversation nobody asked for.
             */}
            {!column.isStreaming && (
              <div className="flex flex-col items-start gap-xs pt-sm">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isPromoting}
                  onClick={onPromote}
                >
                  Continue with this one
                </Button>

                {promoteError && (
                  <p role="alert" className="text-body-sm text-danger">
                    {promoteError}
                  </p>
                )}
              </div>
            )}
          </div>
        ) : column.error ? (
          // Refused before a single token — a spent allowance, a tripped
          // breaker, a provider with no key. A per-column error state that does
          // not disturb the other, which is only true because the other is a
          // separate request: this says nothing about whether the model beside
          // it answered, and in practice it often did.
          <p role="alert" className="text-body-sm text-danger">
            {column.error}
          </p>
        ) : (
          <p className="text-body-sm text-mute">
            {column.isStreaming
              ? 'Thinking…'
              : hasRun
                ? 'Nothing came back from this model.'
                : 'This model’s answer will appear here.'}
          </p>
        )}
      </div>
    </section>
  )
}
