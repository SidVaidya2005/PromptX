'use client'

import { useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'

import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'

import type { ChatMessage } from '@/lib/messages'

import { Composer } from '@/components/chat/Composer'
import { Thread } from '@/components/chat/Thread'

import type { Provider } from '@/types/domain'

type ChatProps = {
  /** Null on /chat. The server creates the conversation as the first answer streams. */
  conversationId: string | null
  initialMessages: ChatMessage[]
  provider: Provider
  modelId: string
  /** Shown above the composer when there is nothing to read yet. */
  emptyState?: React.ReactNode
}

/**
 * The conversation surface, shared by /chat and /chat/[id].
 *
 * One component for both, because a new conversation and an existing one differ
 * only in whether `conversationId` is null. Splitting them would mean two
 * streaming paths to keep in step.
 *
 * A brand-new conversation has no URL while its first answer streams. The
 * server sends the id it created as a transient data part, `onData` catches it,
 * and the URL is corrected once the response finishes — a real navigation
 * rather than a history rewrite, so the router's idea of the route stays true.
 */
export function Chat({
  conversationId,
  initialMessages,
  provider,
  modelId,
  emptyState,
}: ChatProps) {
  const router = useRouter()
  const createdConversationId = useRef<string | null>(null)

  /**
   * Asks the server to name a brand-new conversation, then refreshes again so
   * the sidebar picks the name up.
   *
   * A second refresh on purpose. The one in `onFinish` lands the message and the
   * new sidebar row immediately; this one lands the title a moment later, once
   * the model has produced it. Waiting for the title before the first refresh
   * would hold the whole sidebar back on a request nobody is waiting for.
   */
  async function nameConversation(id: string) {
    if (await requestTitle(id)) router.refresh()
  }

  // Rebuilding the transport every render would hand useChat a new object on
  // each keystroke.
  const transport = useMemo(
    () =>
      new DefaultChatTransport<ChatMessage>({
        api: '/api/chat',
        // Only the newest turn goes over the wire. The server loads history
        // from the database — a stated invariant, not an optimisation, because
        // a client must not be able to rewrite its own past turns.
        prepareSendMessagesRequest: ({ messages }) => ({
          body: {
            conversationId,
            message: messages[messages.length - 1],
            provider,
            modelId,
          },
        }),
      }),
    [conversationId, provider, modelId],
  )

  const { messages, sendMessage, status, stop, error } = useChat<ChatMessage>({
    // Gives each conversation its own isolated state when switching between them.
    id: conversationId ?? 'new',
    messages: initialMessages,
    transport,
    onData: (part) => {
      if (part.type === 'data-conversation') {
        createdConversationId.current = (part.data as { id: string }).id
      }
    },
    onFinish: () => {
      const created = createdConversationId.current

      if (created) {
        createdConversationId.current = null
        router.replace(`/chat/${created}`)
      }

      // Required in both cases: Next preserves a layout across navigation, and
      // the sidebar's conversation query lives in that layout. Without this a
      // new conversation never appears and an existing one never moves up.
      router.refresh()

      // Only the request that created the conversation asks for a title, which
      // is exactly the request whose exchange the title is drawn from. Every
      // later message skips it, so there is no round trip per turn forever.
      //
      // Deliberately not awaited: onFinish must not block on it, and there is
      // nothing to do if it fails. The server refuses idempotently, so an
      // interrupted first answer simply leaves the conversation as 'New chat'.
      if (created) void nameConversation(created)
    },
  })

  const isStreaming = status === 'submitted' || status === 'streaming'

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {messages.length === 0 && emptyState ? (
          emptyState
        ) : (
          <Thread messages={messages} isStreaming={isStreaming} modelId={modelId} />
        )}
      </div>

      {/* The hook's own error, as distinct from a message that failed after
          partially arriving — that one carries its error in the thread. */}
      {error && (
        <p
          role="alert"
          className="mx-auto w-full max-w-180 px-lg text-body-sm text-danger"
        >
          Something went wrong. Try sending that again.
        </p>
      )}

      <Composer
        modelId={modelId}
        isStreaming={isStreaming}
        onSend={(text) => void sendMessage({ text })}
        onStop={() => void stop()}
      />
    </div>
  )
}

/**
 * True when the server actually wrote a title.
 *
 * False covers every other outcome identically — refused, already named, model
 * failed, network down — because the caller does the same thing in all of them:
 * nothing. Titling is a courtesy, and a conversation called 'New chat' is a
 * working conversation.
 */
async function requestTitle(conversationId: string): Promise<boolean> {
  try {
    const response = await fetch('/api/title', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId }),
    })

    if (!response.ok) return false

    const { title } = (await response.json()) as { title: string | null }
    return title !== null
  } catch {
    return false
  }
}
