'use client'

/**
 * Asks the server to name a conversation from its first exchange. (F10)
 *
 * Extracted out of `Chat.tsx` at F32, which gained a second caller: promoting a
 * comparison creates a conversation holding exactly the complete first exchange
 * the titler reads. Two copies of an endpoint's contract is how they drift, and
 * this one has a return convention that is easy to get subtly wrong.
 *
 * **True only when the server actually wrote a title.** False covers every other
 * outcome identically — refused, already named, model failed, network down —
 * because both callers do the same thing in all of them: nothing beyond skipping
 * the refresh. Titling is a courtesy, and a conversation called 'New chat' is a
 * working conversation.
 *
 * The route is idempotent and gated on the title still being the default, so
 * calling it twice, or after a manual rename, is safe.
 */
export async function requestTitle(conversationId: string): Promise<boolean> {
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
