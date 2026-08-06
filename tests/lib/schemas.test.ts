import { describe, expect, it } from 'vitest'

import { chatRequestSchema } from '@/lib/schemas'

/**
 * `editMessageId` was added to a schema every send in the application already
 * goes through, so the risk it carries is not that edits break — it is that
 * ordinary messages do. A field that became required by accident would refuse
 * every normal send with `invalid_input`, which looks like a chat outage rather
 * than a schema mistake.
 */
const base = {
  conversationId: crypto.randomUUID(),
  message: {
    id: 'msg-1',
    role: 'user' as const,
    parts: [{ type: 'text' as const, text: 'hello' }],
  },
  provider: 'google' as const,
  modelId: 'gemini-3.6-flash',
}

describe('chatRequestSchema', () => {
  it('accepts an ordinary send with no editMessageId at all', () => {
    expect(chatRequestSchema.safeParse(base).success).toBe(true)
  })

  it('accepts null and undefined, which are how "not an edit" arrives', () => {
    expect(chatRequestSchema.safeParse({ ...base, editMessageId: null }).success).toBe(
      true,
    )
    expect(
      chatRequestSchema.safeParse({ ...base, editMessageId: undefined }).success,
    ).toBe(true)
  })

  it('accepts a uuid', () => {
    const parsed = chatRequestSchema.safeParse({
      ...base,
      editMessageId: '11111111-2222-4333-8444-555555555555',
    })

    expect(parsed.success).toBe(true)
    expect(parsed.data?.editMessageId).toBe('11111111-2222-4333-8444-555555555555')
  })

  it('rejects anything that is not a uuid', () => {
    // The id reaches a SQL function as a uuid parameter. Refusing a malformed
    // one here costs a 400 instead of a database error the route would have to
    // report as an internal fault.
    expect(chatRequestSchema.safeParse({ ...base, editMessageId: 'nope' }).success).toBe(
      false,
    )
    expect(chatRequestSchema.safeParse({ ...base, editMessageId: 42 }).success).toBe(
      false,
    )
  })

  it('still requires a conversationId key, nullable for a new conversation', () => {
    expect(chatRequestSchema.safeParse({ ...base, conversationId: null }).success).toBe(
      true,
    )

    const withoutConversation: Record<string, unknown> = { ...base }
    delete withoutConversation.conversationId

    expect(chatRequestSchema.safeParse(withoutConversation).success).toBe(false)
  })
})
