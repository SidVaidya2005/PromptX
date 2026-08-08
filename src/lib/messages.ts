/**
 * The bridge between how messages are stored and how the AI SDK carries them.
 *
 * Postgres holds one `content` column. The SDK holds a list of typed parts.
 * Everything the application persists is text, so the mapping is narrow on
 * purpose — a row becomes exactly one text part, and never more.
 */

import type { FileUIPart, UIMessage } from 'ai'

import type { Message, MessageStatus } from '@/types/domain'

/**
 * What a persisted row knows that a streamed message does not.
 *
 * Carried as metadata because the alternative loses it: mapping a row to a bare
 * UIMessage drops `status` and `error_message`, so a failed response would
 * render with its error state until the page was reloaded and then come back
 * looking like an ordinary answer. Live streamed messages have no metadata at
 * all, which reads as "still fine".
 */
export type MessageMetadata = {
  status: MessageStatus
  errorMessage: string | null
  /**
   * Which model wrote this. Null on user rows, and on assistant rows written
   * before the column was populated. A live streaming message has no metadata
   * at all, so the thread falls back to the model the composer is set to —
   * which is, by definition, the one answering.
   */
  modelId: string | null
}

export type ChatMessage = UIMessage<MessageMetadata>

/**
 * Database rows as the AI SDK sees them, for seeding a thread on load.
 *
 * The row id is reused as the message id rather than generating a fresh one, so
 * a message keeps the same identity across a reload and React does not tear
 * down and rebuild the whole thread.
 *
 * An empty `content` still yields a text part. An assistant row that failed
 * before producing anything is a real message with a real error to display, and
 * dropping it here would make it vanish from the thread on the next reload
 * while remaining in the database.
 */
export function toUIMessages(messages: readonly Message[]): ChatMessage[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    metadata: {
      status: message.status,
      errorMessage: message.error_message,
      modelId: message.model_id,
    },
    parts: [{ type: 'text' as const, text: message.content }],
  }))
}

/**
 * Adds a message's files ahead of its text, for the model's benefit only. (F29)
 *
 * Kept apart from `toUIMessages()` deliberately, so that function stays exactly
 * what its own comment claims — one row, one text part — for the client path
 * that seeds the browser. Attachments reach the *screen* through a map keyed by
 * message id, not through parts, because a message that has just been sent
 * exists only in `useChat` state where no server render can reach it.
 *
 * This is therefore server-only in practice: it runs in the chat route, on
 * parts whose bytes were read out of Storage there.
 *
 * Files come before the text because that is the order the sentence assumes —
 * "here is the image, now my question about it" — and a model reading the
 * question first has to hold it until the attachment arrives.
 */
export function withFileParts<T extends UIMessage>(
  messages: readonly T[],
  partsByMessageId: ReadonlyMap<string, FileUIPart[]>,
): T[] {
  return messages.map((message) => {
    const files = partsByMessageId.get(message.id)
    if (!files || files.length === 0) return message

    return { ...message, parts: [...files, ...message.parts] }
  })
}
