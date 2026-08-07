import type { ChatMessage } from '@/lib/messages'

import { AssistantMessage } from '@/components/chat/AssistantMessage'
import { UserMessage } from '@/components/chat/UserMessage'

import type { Provider } from '@/types/domain'

type MessageBubbleProps = {
  message: ChatMessage
  /** True only for the response currently being generated. */
  isStreaming: boolean
  /** The composer's model, used for a live message that has no metadata yet. */
  fallbackProvider: Provider
  fallbackModelId: string
  /** Providers this user holds a key for, for the regenerate menu's gating. */
  configuredProviders: readonly Provider[]
  /** Shared-key messages left today. */
  remaining: number
  /** False while the global monthly ceiling is spent. */
  sharedKeyAvailable: boolean
  /** True for the brief flash after the outline rail jumps to this message. */
  isHighlighted: boolean
  /** False while a response is in flight — one generation at a time. */
  canEdit: boolean
  /** True only on the newest assistant message, once it has settled. */
  canRegenerate: boolean
  /** Messages after this one, which an edit would delete. */
  followingCount: number
  onEdit: (id: string, text: string) => void
  onRegenerate: (id: string, model?: { provider: Provider; modelId: string }) => void
}

/**
 * One message in the thread, routed to the half that knows how to draw it.
 *
 * The asymmetry is deliberate and comes straight from DESIGN.md: a user message
 * is a card, an assistant message has no chrome at all. Responses are the
 * content, not a card sitting on the page. That difference grew past styling
 * once each side gained its own controls — an inline editor and a destructive
 * confirmation on one, a regenerate menu on the other — so this file routes and
 * the two components own their own markup.
 */
export function MessageBubble({
  message,
  isStreaming,
  fallbackProvider,
  fallbackModelId,
  configuredProviders,
  remaining,
  sharedKeyAvailable,
  isHighlighted,
  canEdit,
  canRegenerate,
  followingCount,
  onEdit,
  onRegenerate,
}: MessageBubbleProps) {
  // The outline rail's scroll target lives inside each half, along with whatever
  // replaces the bubble. A hand-written id, which the shell columns are
  // forbidden — but that rule exists because below 1024px a column is in the
  // document twice, once as the display:none desktop aside and once as the
  // mounted sheet. The thread is not: `children` renders exactly once in
  // AppShell, so these ids are unique.
  const text = message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('')

  if (message.role === 'user') {
    return (
      <UserMessage
        id={message.id}
        text={text}
        isHighlighted={isHighlighted}
        canEdit={canEdit}
        followingCount={followingCount}
        onEdit={onEdit}
      />
    )
  }

  return (
    <AssistantMessage
      id={message.id}
      text={text}
      failed={message.metadata?.status === 'error'}
      errorMessage={message.metadata?.errorMessage ?? null}
      isStreaming={isStreaming}
      // A live message has no metadata of its own yet, so it falls back to the
      // model the composer is set to — which is, by definition, the one
      // answering. A persisted row carries the model that actually produced it,
      // which is what keeps a thread whose model changed partway legible.
      modelId={message.metadata?.modelId ?? fallbackModelId}
      fallbackProvider={fallbackProvider}
      fallbackModelId={fallbackModelId}
      configuredProviders={configuredProviders}
      remaining={remaining}
      sharedKeyAvailable={sharedKeyAvailable}
      canRegenerate={canRegenerate}
      onRegenerate={onRegenerate}
    />
  )
}
