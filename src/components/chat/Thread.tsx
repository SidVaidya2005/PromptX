import type { ChatMessage } from '@/lib/messages'

import { MessageBubble } from '@/components/chat/MessageBubble'

type ThreadProps = {
  messages: readonly ChatMessage[]
}

/**
 * The conversation, oldest first.
 *
 * The 720px measure is DESIGN.md's thread measure, centred inside the fluid
 * middle column so long responses stay readable on a wide display.
 */
export function Thread({ messages }: ThreadProps) {
  return (
    <div className="mx-auto flex w-full max-w-180 flex-col gap-lg px-lg py-xl">
      {messages.map((message) => (
        <MessageBubble key={message.id} message={message} />
      ))}
    </div>
  )
}
