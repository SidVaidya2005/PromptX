import { describe, expect, it } from 'vitest'

import { MAX_TITLE_LENGTH } from '@/lib/constants'
import { chatRequestSchema, chatSendSchema, updateConversationSchema } from '@/lib/schemas'

const EDIT_ID = '11111111-2222-4333-8444-555555555555'

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
    // Read through the send branch rather than off the union: `editMessageId`
    // exists on one member only, which is the entire point of the split below.
    expect(chatSendSchema.parse({ ...base, editMessageId: EDIT_ID }).editMessageId).toBe(
      EDIT_ID,
    )
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

/**
 * Feature 20 split this schema into two shapes, and the split is the feature.
 *
 * A regeneration carries no `message` — the prompt is already a row, and not
 * re-sending it is what stops the server appending the same question twice.
 * These tests are about the seam between the two branches rather than about
 * either one, because that seam is where the failure would be silent.
 */
describe('chatRequestSchema — send or regenerate', () => {
  const regenerate = {
    conversationId: base.conversationId,
    provider: base.provider,
    modelId: base.modelId,
    regenerate: true,
  }

  it('accepts a regeneration carrying no message at all', () => {
    expect(chatRequestSchema.safeParse(regenerate).success).toBe(true)
  })

  it('rejects a body that is neither — no message and no regenerate flag', () => {
    const neither = {
      conversationId: base.conversationId,
      provider: base.provider,
      modelId: base.modelId,
    }

    expect(chatRequestSchema.safeParse(neither).success).toBe(false)
  })

  /**
   * The one that matters, and the reason both branches are `.strict()`.
   *
   * `z.union` tries its members in order, and an ordinary zod object *strips*
   * keys it does not declare. Without strict, this body matches the send branch,
   * the `regenerate` flag is silently dropped, and the route handles a
   * regeneration as a perfectly ordinary send — appending the prompt a second
   * time while the screen shows exactly the right thing. Nothing surfaces until
   * a reload.
   *
   * Verified by mutation rather than by reading: removing `.strict()` from
   * `chatSendSchema` turns this test red and leaves every other test in this
   * file green, which is what makes it the guard rather than decoration.
   */
  it('rejects a body claiming to be both a send and a regeneration', () => {
    const both = { ...base, regenerate: true }

    expect(chatRequestSchema.safeParse(both).success).toBe(false)
  })

  it('rejects an unknown key rather than quietly discarding it', () => {
    // Same strictness, seen from the side that is easier to trip over: a typo
    // in a per-call body override reaches the server as a field nobody reads.
    expect(chatRequestSchema.safeParse({ ...regenerate, regenrate: true }).success).toBe(
      false,
    )
  })

  it('rejects a regenerate flag that is not literally true', () => {
    // A literal rather than a boolean, so `regenerate: false` cannot arrive and
    // mean "an ordinary send" — a shape with no `message` that the route would
    // then have to decide about.
    expect(
      chatRequestSchema.safeParse({ ...regenerate, regenerate: false }).success,
    ).toBe(false)
  })

  /**
   * The regression test for the bug this branch was redesigned around.
   *
   * The first version named the assistant row being replaced, taking the
   * `messageId` the AI SDK offers `prepareSendMessagesRequest`. That id is a
   * database uuid only when the message came from the server; one that has just
   * streamed carries an id the SDK generated, and `a6i8GltgJ1K7KZtE` below is a
   * real value observed on a real second regeneration, which the route refused
   * as a malformed uuid.
   *
   * The schema now carries no id at all, so this asserts the field is gone
   * rather than that it validates. Strict is what makes that assertion possible:
   * a leftover id is a rejected body, not a silently ignored key.
   */
  it('carries no message id, because the client cannot reliably know one', () => {
    expect(
      chatRequestSchema.safeParse({
        ...regenerate,
        regenerateMessageId: 'a6i8GltgJ1K7KZtE',
      }).success,
    ).toBe(false)
  })

  it('still requires a provider and model on a regeneration', () => {
    // Both live on the shared base rather than on the send branch, because a
    // regeneration may name a DIFFERENT model from the conversation's own — that
    // is the whole "with a different model" affordance, and it arrives here.
    const withoutModel: Record<string, unknown> = { ...regenerate }
    delete withoutModel.modelId

    expect(chatRequestSchema.safeParse(withoutModel).success).toBe(false)
  })
})

/**
 * Feature 21 turned the conversation PATCH body into a union, and the union is
 * what these are about.
 *
 * One endpoint now carries three unrelated intents — change the model, rename,
 * pin — and the only thing that distinguishes them is the shape of the body. So
 * the interesting failures are not "a bad title is accepted"; they are a body
 * that means two things being quietly answered as one of them.
 */
describe('updateConversationSchema', () => {
  const model = { provider: 'google' as const, modelId: 'gemini-3.6-flash' }

  it('accepts each of the three intents on its own', () => {
    expect(updateConversationSchema.safeParse(model).success).toBe(true)
    expect(updateConversationSchema.safeParse({ title: 'Rent contract' }).success).toBe(
      true,
    )
    expect(updateConversationSchema.safeParse({ pinned: true }).success).toBe(true)
    expect(updateConversationSchema.safeParse({ pinned: false }).success).toBe(true)
  })

  /**
   * The one that matters, and the reason every branch is `.strict()`.
   *
   * `z.union` tries its members in order and an ordinary zod object *strips*
   * keys it does not declare. Without strict, this body matches the model branch
   * first, `title` is dropped on the floor, and the route answers a rename it
   * never performed — 200 with the old title still in the database.
   *
   * Verified by mutation rather than by reading: removing `.strict()` from
   * `updateConversationModelSchema` turns this test red and leaves the rest of
   * this describe green.
   */
  it('rejects a body claiming two intents at once', () => {
    expect(updateConversationSchema.safeParse({ ...model, title: 'Both' }).success).toBe(
      false,
    )
    expect(updateConversationSchema.safeParse({ title: 'Both', pinned: true }).success).toBe(
      false,
    )
    expect(updateConversationSchema.safeParse({ ...model, pinned: true }).success).toBe(
      false,
    )
  })

  it('rejects an unknown key rather than quietly discarding it', () => {
    // A typo in a client body would otherwise reach the server as a field
    // nobody reads, and be answered as though it had been honoured.
    expect(updateConversationSchema.safeParse({ titel: 'Typo' }).success).toBe(false)
    expect(updateConversationSchema.safeParse({ pinned: true, extra: 1 }).success).toBe(
      false,
    )
  })

  it('rejects a body that is none of the three', () => {
    expect(updateConversationSchema.safeParse({}).success).toBe(false)
    expect(updateConversationSchema.safeParse({ archived: true }).success).toBe(false)
  })

  /**
   * `.trim()` is declared before `.min()` and `.max()`, and on zod 4.4.3 checks
   * run in declaration order — so the bounds see the trimmed value. Reversed,
   * `'   '` passes `.min(1)` and is stored as an empty string, which is a
   * conversation with no name in the sidebar and no way to tell why.
   *
   * Verified by mutation: moving `.trim()` after `.max()` turns the
   * whitespace-only case and the padded-title case red together.
   */
  it('rejects an empty or whitespace-only title', () => {
    expect(updateConversationSchema.safeParse({ title: '' }).success).toBe(false)
    expect(updateConversationSchema.safeParse({ title: '   ' }).success).toBe(false)
    expect(updateConversationSchema.safeParse({ title: '\n\t ' }).success).toBe(false)
  })

  it('trims before measuring, so padding cannot push a legal title over the cap', () => {
    const exact = 'a'.repeat(MAX_TITLE_LENGTH)
    const parsed = updateConversationSchema.safeParse({ title: `  ${exact}  ` })

    expect(parsed.success).toBe(true)
    // The stored value is the trimmed one. The server is authoritative about
    // whitespace; a client that trims too is being convenient, not the guard.
    expect(parsed.success && 'title' in parsed.data && parsed.data.title).toBe(exact)
  })

  it('rejects a title one character over the cap', () => {
    expect(
      updateConversationSchema.safeParse({ title: 'a'.repeat(MAX_TITLE_LENGTH + 1) })
        .success,
    ).toBe(false)
  })

  it('rejects a pin that is not a boolean', () => {
    // Desired state, so the value has to be one of exactly two things. A string
    // 'true' arriving from a hand-rolled fetch must not read as pinned.
    expect(updateConversationSchema.safeParse({ pinned: 'true' }).success).toBe(false)
    expect(updateConversationSchema.safeParse({ pinned: null }).success).toBe(false)
  })
})
