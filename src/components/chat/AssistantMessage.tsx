import { cn } from '@/lib/utils'

import { CopyButton } from '@/components/chat/CopyButton'
import { MarkdownErrorBoundary } from '@/components/chat/MarkdownErrorBoundary'
import { MarkdownMessage } from '@/components/chat/MarkdownMessage'
import { RegenerateMenu } from '@/components/chat/RegenerateMenu'

import type { Provider } from '@/types/domain'

type AssistantMessageProps = {
  id: string
  text: string
  /** True when the response failed or was stopped partway. */
  failed: boolean
  errorMessage: string | null
  /** True only for the response currently being generated. */
  isStreaming: boolean
  /** The model that produced this, or the composer's while it is still live. */
  modelId: string
  /** What a regeneration defaults to when no other model is chosen. */
  fallbackProvider: Provider
  fallbackModelId: string
  configuredProviders: readonly Provider[]
  remaining: number
  sharedKeyAvailable: boolean
  /** True only on the newest assistant message, once it has settled. */
  canRegenerate: boolean
  onRegenerate: (id: string, model?: { provider: Provider; modelId: string }) => void
}

/**
 * A model's response.
 *
 * Split out of `MessageBubble` at feature 20, mirroring the split feature 19
 * made for `UserMessage`: the meta row gained a regenerate menu, and leaving
 * both halves inline would have pushed that file past the point
 * `code-standards.md` calls a defect.
 *
 * No fill and no border, per DESIGN.md `message-assistant`. The absence of
 * chrome is the design, not an omission — responses are the content, not a card
 * sitting on the page.
 */
export function AssistantMessage({
  id,
  text,
  failed,
  errorMessage,
  isStreaming,
  modelId,
  fallbackProvider,
  fallbackModelId,
  configuredProviders,
  remaining,
  sharedKeyAvailable,
  canRegenerate,
  onRegenerate,
}: AssistantMessageProps) {
  return (
    <div className="group flex flex-col">
      <div
        className={cn(
          'w-full py-lg text-body-md text-body-strong',
          // DESIGN.md `message-error`. Applied around the body rather than
          // replacing it, so whatever partial content arrived stays readable
          // above the explanation.
          failed && 'rounded-md border border-danger bg-canvas-soft px-lg py-md',
        )}
      >
        <MarkdownErrorBoundary content={text}>
          <MarkdownMessage content={text} isStreaming={isStreaming} />
        </MarkdownErrorBoundary>

        {failed && (
          <p className={cn('text-body-sm text-danger', text && 'pt-sm')}>
            {errorMessage ?? 'This response did not finish.'}
          </p>
        )}
      </div>

      {/* DESIGN.md `message-meta`. Revealed on hover, and on keyboard focus so
          the controls are reachable without a pointer at all. The coarse
          variant is the one that matters: a thread whose model changed partway
          is only readable if this line survives on a device with no hover
          state, and without it the regenerate menu would be unreachable there
          entirely. */}
      <div
        className={cn(
          'flex items-center gap-md font-mono text-code text-mute',
          'opacity-0 transition-opacity',
          'group-focus-within:opacity-100 group-hover:opacity-100',
          'pointer-coarse:opacity-100',
        )}
      >
        <span>{modelId}</span>
        {/* The raw markdown, not the rendered text — pasting an answer into an
            editor should give back the fences and the list markers. */}
        <CopyButton value={text} label="Copy message" />

        {/* Offered on a failed response too, and deliberately: an answer that
            broke halfway or was stopped is the likeliest reason anyone reaches
            for this, and withholding it there would leave retyping the prompt
            as the only way back. */}
        {canRegenerate && (
          <RegenerateMenu
            provider={fallbackProvider}
            modelId={fallbackModelId}
            configuredProviders={configuredProviders}
            remaining={remaining}
            sharedKeyAvailable={sharedKeyAvailable}
            onRegenerate={(model) => onRegenerate(id, model)}
          />
        )}
      </div>
    </div>
  )
}
