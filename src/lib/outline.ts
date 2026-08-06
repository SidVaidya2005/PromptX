/**
 * The outline rail's derivation logic, kept pure so it can be tested.
 *
 * Nothing UI-shaped has automated coverage until feature 36 — vitest runs in a
 * node environment against `tests/`, with no jsdom and no component testing
 * library. What survives that limitation is the part of this feature that is
 * really a data transformation: which messages become entries, what text they
 * carry, and whether the column appears at all. That is why these live here
 * rather than inline in the components that call them, exactly as
 * `src/lib/conversations.ts` holds the sidebar's grouping.
 */

import { OUTLINE_ENTRY_CHAR_LIMIT, OUTLINE_MIN_EXCHANGES } from '@/lib/constants'
import type { ChatMessage } from '@/lib/messages'
import { textOf } from '@/lib/utils'

/** One jump target: the message it points at, and the label the rail shows. */
export type OutlineEntry = {
  /** The message id, which is also what `outlineAnchorId` is built from. */
  id: string
  label: string
}

/**
 * The user's own prompts in a thread, in order.
 *
 * Assistant messages are deliberately absent. The rail answers "where did I ask
 * about X" — responses are what you scroll *through*, not what you navigate by,
 * and including them would double the list while halving its usefulness.
 *
 * An empty label is kept rather than filtered. A prompt that is empty is still a
 * real message occupying a real position in the thread, and dropping it here
 * would leave a jump target missing with nothing to explain the gap.
 */
export function toOutlineEntries(
  messages: readonly ChatMessage[],
): readonly OutlineEntry[] {
  return messages
    .filter((message) => message.role === 'user')
    .map((message) => ({ id: message.id, label: toLabel(textOf(message)) }))
}

/**
 * The DOM id of a message's scroll anchor.
 *
 * Spelled in one place so the writer in `MessageBubble` and the readers in
 * `Chat` and the tracking hook cannot drift — a mismatch would not throw, it
 * would silently make every jump a no-op.
 *
 * These ids are safe despite the rule that no element in a shell column may
 * carry a hand-written one. That rule exists because below 1024px a column is in
 * the document twice, once as the `display:none` desktop aside and once as the
 * mounted sheet. Messages are not: `children` is rendered exactly once in
 * `AppShell`. The rail's own items therefore carry `aria-current`, never an id.
 */
export function outlineAnchorId(messageId: string): string {
  return `message-${messageId}`
}

/** Whether the rail — and the whole right column with it — is on screen at all. */
export function isOutlineVisible(entryCount: number): boolean {
  return entryCount >= OUTLINE_MIN_EXCHANGES
}

/**
 * A prompt as one line of rail text.
 *
 * Newlines collapse because the entry is clamped to two lines and a prompt that
 * opens with a blank line would otherwise spend one of them on nothing. No
 * ellipsis is appended: the clamp already draws one for text that overflows
 * visually, and adding a second for text cut by the character budget would show
 * two different truncation marks for the same idea.
 */
function toLabel(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()

  return collapsed.slice(0, OUTLINE_ENTRY_CHAR_LIMIT)
}
