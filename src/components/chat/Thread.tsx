import { MessageBubble } from '@/components/chat/MessageBubble'

import type { Message } from '@/types/domain'

type ThreadProps = {
  messages: readonly Message[]
}

/**
 * The conversation, oldest first.
 *
 * A Server Component with no interactivity, so none of this reaches the client
 * bundle — which matters more here than usual, since no CDN sits in front of
 * the origin and a long thread is a lot of markup.
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
