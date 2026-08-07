import type { ChatMessage } from '@/lib/messages'

import { MessageBubble } from '@/components/chat/MessageBubble'

import type { Provider } from '@/types/domain'

type ThreadProps = {
  messages: readonly ChatMessage[]
  /** True while a response is in flight. Applies to the last message only. */
  isStreaming: boolean
  /** The composer's model, for a live message with no metadata of its own. */
  provider: Provider
  modelId: string
  /** Providers this user holds a key for, for the regenerate menu's gating. */
  configuredProviders: readonly Provider[]
  /** Shared-key messages left today. Gates regenerating on a shared model. */
  remaining: number
  /** False while the global monthly ceiling is spent. */
  sharedKeyAvailable: boolean
  /** The message a rail jump just landed on, flashed briefly. Null otherwise. */
  highlightedId: string | null
  onEdit: (id: string, text: string) => void
  onRegenerate: (id: string, model?: { provider: Provider; modelId: string }) => void
}

/**
 * The conversation, oldest first.
 *
 * The 720px measure is DESIGN.md's thread measure, centred inside the fluid
 * middle column so long responses stay readable on a wide display.
 */
export function Thread({
  messages,
  isStreaming,
  provider,
  modelId,
  configuredProviders,
  remaining,
  sharedKeyAvailable,
  highlightedId,
  onEdit,
  onRegenerate,
}: ThreadProps) {
  return (
    <div className="mx-auto flex w-full max-w-180 flex-col gap-lg px-lg py-xl">
      {messages.map((message, index) => {
        const isLast = index === messages.length - 1

        return (
          <MessageBubble
            key={message.id}
            message={message}
            // Only the final assistant message can be the one being generated;
            // everything above it is settled and should highlight immediately.
            isStreaming={isStreaming && isLast && message.role === 'assistant'}
            fallbackProvider={provider}
            fallbackModelId={modelId}
            configuredProviders={configuredProviders}
            remaining={remaining}
            sharedKeyAvailable={sharedKeyAvailable}
            isHighlighted={message.id === highlightedId}
            // No editing while an answer is arriving. The request in flight is
            // building on this thread, and rewriting its history underneath it
            // would leave the response answering a question that no longer exists.
            canEdit={!isStreaming}
            // Only the newest answer, and only once it has stopped moving. The
            // server enforces the same rule from the thread it loads, so this is
            // the affordance agreeing with it rather than the check itself.
            canRegenerate={!isStreaming && isLast && message.role === 'assistant'}
            // What an edit here would delete. Zero means the confirmation is
            // skipped, because there is nothing to warn about.
            followingCount={messages.length - 1 - index}
            onEdit={onEdit}
            onRegenerate={onRegenerate}
          />
        )
      })}
    </div>
  )
}
