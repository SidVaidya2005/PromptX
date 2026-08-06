import { cn } from '@/lib/utils'
import type { ChatMessage } from '@/lib/messages'
import { outlineAnchorId } from '@/lib/outline'

import { CopyButton } from '@/components/chat/CopyButton'
import { MarkdownErrorBoundary } from '@/components/chat/MarkdownErrorBoundary'
import { MarkdownMessage } from '@/components/chat/MarkdownMessage'

type MessageBubbleProps = {
  message: ChatMessage
  /** True only for the response currently being generated. */
  isStreaming: boolean
  /** The composer's model, used for a live message that has no metadata yet. */
  fallbackModelId: string
  /** True for the brief flash after the outline rail jumps to this message. */
  isHighlighted: boolean
}

/**
 * One message in the thread.
 *
 * The asymmetry is deliberate and comes straight from DESIGN.md: a user message
 * is a card, an assistant message has no chrome at all. Responses are the
 * content, not a card sitting on the page.
 *
 * Only the assistant body is markdown. A user message stays literal, because
 * rendering it would quietly rewrite the person's own words — someone pasting a
 * snippet that starts with `#` would see a heading where they typed a comment,
 * and what is on screen would no longer match what the model was sent.
 */
export function MessageBubble({
  message,
  isStreaming,
  fallbackModelId,
  isHighlighted,
}: MessageBubbleProps) {
  const isUser = message.role === 'user'
  const failed = message.metadata?.status === 'error'

  const text = message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('')

  if (isUser) {
    return (
      // The outline rail's scroll target. A hand-written id, which the shell
      // columns are forbidden — but that rule exists because below 1024px a
      // column is in the document twice, once as the display:none desktop aside
      // and once as the mounted sheet. The thread is not: `children` renders
      // exactly once in AppShell, so these ids are unique. scroll-mt keeps a
      // jumped-to message off the top edge instead of flush against it.
      <div id={outlineAnchorId(message.id)} className="flex scroll-mt-lg justify-end">
        <div
          className={cn(
            'max-w-4/5 rounded-md border border-hairline bg-canvas-soft px-lg py-md',
            'text-body-md whitespace-pre-wrap text-ink transition-colors',
            // The jump's acknowledgement. Brightening the existing hairline
            // rather than adding a ring keeps it inside the elevation system —
            // DESIGN.md builds emphasis from surface contrast, not from a new
            // outline, and a coloured one would need a chromatic accent that
            // does not exist here.
            isHighlighted && 'border-primary',
          )}
        >
          {text}
        </div>
      </div>
    )
  }

  const modelId = message.metadata?.modelId ?? fallbackModelId

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
            {message.metadata?.errorMessage ?? 'This response did not finish.'}
          </p>
        )}
      </div>

      {/* DESIGN.md `message-meta`. Revealed on hover, and on keyboard focus so
          the copy button is reachable without a pointer at all. The coarse
          variant is the one that matters for legibility: a thread whose model
          changed partway is only readable if this line survives on a device
          with no hover state. */}
      <div
        className={cn(
          'flex items-center gap-md font-mono text-code text-mute',
          'opacity-0 transition-opacity',
          'group-hover:opacity-100 group-focus-within:opacity-100',
          'pointer-coarse:opacity-100',
        )}
      >
        <span>{modelId}</span>
        {/* The raw markdown, not the rendered text — pasting an answer into an
            editor should give back the fences and the list markers. */}
        <CopyButton value={text} label="Copy message" />
      </div>
    </div>
  )
}
