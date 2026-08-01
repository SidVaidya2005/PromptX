import type { ChatMessage } from '@/lib/messages'

import { MessageBubble } from '@/components/chat/MessageBubble'

type ThreadProps = {
  messages: readonly ChatMessage[]
  /** True while a response is in flight. Applies to the last message only. */
  isStreaming: boolean
  /** The composer's model, for a live message with no metadata of its own. */
  modelId: string
}

/**
 * The conversation, oldest first.
 *
 * The 720px measure is DESIGN.md's thread measure, centred inside the fluid
 * middle column so long responses stay readable on a wide display.
 */
export function Thread({ messages, isStreaming, modelId }: ThreadProps) {
  return (
    <div className="mx-auto flex w-full max-w-180 flex-col gap-lg px-lg py-xl">
      {messages.map((message, index) => (
        <MessageBubble
          key={message.id}
          message={message}
          // Only the final assistant message can be the one being generated;
          // everything above it is settled and should highlight immediately.
          isStreaming={
            isStreaming && index === messages.length - 1 && message.role === 'assistant'
          }
          fallbackModelId={modelId}
        />
      ))}
    </div>
  )
}
