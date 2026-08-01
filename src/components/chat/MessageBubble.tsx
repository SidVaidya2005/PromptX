import { cn } from '@/lib/utils'
import type { ChatMessage } from '@/lib/messages'

type MessageBubbleProps = {
  message: ChatMessage
}

/**
 * One message in the thread.
 *
 * The content is plain text at this feature. Feature 09 replaces the body with
 * react-markdown and shiki; the geometry below is already what that feature
 * renders into, so only the innermost element changes.
 *
 * The asymmetry is deliberate and comes straight from DESIGN.md: a user message
 * is a card, an assistant message has no chrome at all. Responses are the
 * content, not a card sitting on the page.
 */
export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user'
  const failed = message.metadata?.status === 'error'

  const text = message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('')

  return (
    <div className={cn('flex', isUser && 'justify-end')}>
      <div
        className={cn(
          'whitespace-pre-wrap',
          isUser
            ? 'max-w-4/5 rounded-md border border-hairline bg-canvas-soft px-lg py-md text-body-md text-ink'
            : 'w-full py-lg text-body-md text-body-strong',
          // DESIGN.md `message-error`. Applied to the container rather than
          // replacing it, so whatever partial content arrived stays readable
          // above the explanation.
          failed && 'rounded-md border border-danger bg-canvas-soft px-lg py-md',
        )}
      >
        {text}

        {failed && (
          <p className={cn('text-body-sm text-danger', text && 'pt-sm')}>
            {message.metadata?.errorMessage ?? 'This response did not finish.'}
          </p>
        )}
      </div>
    </div>
  )
}
