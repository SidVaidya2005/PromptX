import { describe, expect, it } from 'vitest'

import {
  MAX_PROMPT_BODY_LENGTH,
  MAX_PROMPT_TAG_LENGTH,
  MAX_PROMPT_TAGS,
  MAX_PROMPT_TITLE_LENGTH,
  MAX_SYSTEM_PROMPT_LENGTH,
  MAX_TITLE_LENGTH,
} from '@/lib/constants'
import {
  createAttachmentSchema,
  chatRequestSchema,
  chatSendSchema,
  createPromptSchema,
  updateConversationSchema,
} from '@/lib/schemas'

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
 * what these are about. F22 added the fourth branch, F23 the fifth.
 *
 * One endpoint carries five unrelated intents — change the model, rename, pin,
 * archive, set a system prompt — and the only thing that distinguishes them is
 * the shape of the body. So the interesting failures are not "a bad title is accepted"; they are
 * a body that means two things being quietly answered as one of them.
 */
describe('updateConversationSchema', () => {
  const model = { provider: 'google' as const, modelId: 'gemini-3.6-flash' }

  it('accepts each intent on its own', () => {
    expect(updateConversationSchema.safeParse(model).success).toBe(true)
    expect(updateConversationSchema.safeParse({ title: 'Rent contract' }).success).toBe(
      true,
    )
    expect(updateConversationSchema.safeParse({ pinned: true }).success).toBe(true)
    expect(updateConversationSchema.safeParse({ pinned: false }).success).toBe(true)
    // F22's fourth branch, which the union was built expecting.
    expect(updateConversationSchema.safeParse({ archived: true }).success).toBe(true)
    expect(updateConversationSchema.safeParse({ archived: false }).success).toBe(true)
    // F23's fifth.
    expect(updateConversationSchema.safeParse({ systemPrompt: 'Be terse.' }).success).toBe(
      true,
    )
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
    // The pairing that would be easiest to send by accident: a menu that
    // archived and unpinned in one request would look entirely reasonable.
    expect(
      updateConversationSchema.safeParse({ archived: true, pinned: false }).success,
    ).toBe(false)
    expect(
      updateConversationSchema.safeParse({ archived: true, title: 'Both' }).success,
    ).toBe(false)
  })

  it('rejects an unknown key rather than quietly discarding it', () => {
    // A typo in a client body would otherwise reach the server as a field
    // nobody reads, and be answered as though it had been honoured.
    expect(updateConversationSchema.safeParse({ titel: 'Typo' }).success).toBe(false)
    expect(updateConversationSchema.safeParse({ pinned: true, extra: 1 }).success).toBe(
      false,
    )
  })

  it('rejects a body that is none of the five', () => {
    expect(updateConversationSchema.safeParse({}).success).toBe(false)
    // `archived` stood here until F22 turned it into a real branch, which is
    // the point of the assertion: an intent the union does not carry yet is
    // refused rather than quietly accepted and dropped.
    expect(updateConversationSchema.safeParse({ starred: true }).success).toBe(false)
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

  /**
   * The system prompt branch, and what makes it different from the other four:
   * null is a VALUE here, not an absence. It is how a prompt is cleared, so
   * `{systemPrompt: null}` and an absent key must not mean the same thing.
   */
  it('accepts a prompt, and accepts null as the way to clear one', () => {
    const set = updateConversationSchema.safeParse({ systemPrompt: 'Be terse.' })
    expect(set.success && 'systemPrompt' in set.data && set.data.systemPrompt).toBe(
      'Be terse.',
    )

    const cleared = updateConversationSchema.safeParse({ systemPrompt: null })
    expect(cleared.success && 'systemPrompt' in cleared.data && cleared.data.systemPrompt).toBe(
      null,
    )
  })

  /**
   * Empty normalises to null rather than being rejected, and the transform is
   * what keeps null the only spelling of "no prompt". Storing `''` would be
   * worse than rejecting it: the chat route sends `system: undefined` for null,
   * so an empty string is a *value* handed to the provider rather than the
   * absence of one.
   *
   * Verified by mutation: moving `.trim()` after `.max()` turns the
   * whitespace case red.
   */
  it('normalises an empty or whitespace-only prompt to null', () => {
    for (const input of ['', '   ', '\n\t ']) {
      const parsed = updateConversationSchema.safeParse({ systemPrompt: input })

      expect(parsed.success && 'systemPrompt' in parsed.data && parsed.data.systemPrompt).toBe(
        null,
      )
    }
  })

  it('trims a prompt and measures the cap against the trimmed length', () => {
    const exact = 'a'.repeat(MAX_SYSTEM_PROMPT_LENGTH)

    const padded = updateConversationSchema.safeParse({ systemPrompt: `  ${exact}  ` })
    expect(padded.success && 'systemPrompt' in padded.data && padded.data.systemPrompt).toBe(
      exact,
    )

    expect(
      updateConversationSchema.safeParse({
        systemPrompt: 'a'.repeat(MAX_SYSTEM_PROMPT_LENGTH + 1),
      }).success,
    ).toBe(false)
  })

  it('rejects a system prompt sent alongside any other intent', () => {
    // The pairing a "save prompt and rename" button would produce, and the one
    // strict is here to refuse rather than silently answer as a rename.
    expect(
      updateConversationSchema.safeParse({ systemPrompt: 'Be terse.', title: 'Both' })
        .success,
    ).toBe(false)
    expect(
      updateConversationSchema.safeParse({ systemPrompt: null, archived: true }).success,
    ).toBe(false)
  })

  it('rejects an archive flag that is not a boolean', () => {
    // Desired state, so it has to be one of exactly two things. A string
    // 'false' is truthy and would archive a conversation nobody asked to hide.
    expect(updateConversationSchema.safeParse({ archived: 'false' }).success).toBe(false)
    expect(updateConversationSchema.safeParse({ archived: null }).success).toBe(false)
  })

  it('rejects a pin that is not a boolean', () => {
    // Desired state, so the value has to be one of exactly two things. A string
    // 'true' arriving from a hand-rolled fetch must not read as pinned.
    expect(updateConversationSchema.safeParse({ pinned: 'true' }).success).toBe(false)
    expect(updateConversationSchema.safeParse({ pinned: null }).success).toBe(false)
  })
})

/**
 * The tag rules are the only part of a prompt that is transformed rather than
 * merely bounded, so they are the only part that can be wrong while looking
 * right. Everything here is about the order the checks run in: element checks
 * first, then `.overwrite()`, then the count — reversed at any point and the cap
 * counts something different from what the database ends up holding.
 */
describe('createPromptSchema', () => {
  const base = { title: 'Code review', body: 'Review this diff for bugs.' }

  function tagsOf(input: unknown): string[] {
    const parsed = createPromptSchema.safeParse(input)
    if (!parsed.success) throw new Error('expected the prompt to parse')

    return parsed.data.tags
  }

  it('lowercases, trims, and deduplicates tags into one', () => {
    expect(tagsOf({ ...base, tags: [' Review ', 'review', 'REVIEW'] })).toEqual([
      'review',
    ])
  })

  it('drops empty and whitespace-only tags rather than storing them', () => {
    expect(tagsOf({ ...base, tags: ['code', '', '   ', 'review'] })).toEqual([
      'code',
      'review',
    ])
  })

  it('preserves the order the tags were given in', () => {
    // A Set iterates in insertion order, which is what keeps the chips on a card
    // in the order their author put them rather than in an arbitrary one.
    expect(tagsOf({ ...base, tags: ['zebra', 'apple', 'mango'] })).toEqual([
      'zebra',
      'apple',
      'mango',
    ])
  })

  it('counts the cap against the deduplicated tags, not the submitted ones', () => {
    // MAX_PROMPT_TAGS + 1 submitted, all the same tag. If `.max()` ran before
    // `.overwrite()` this would be refused for holding nine tags while the
    // database would have held exactly one.
    const duplicates = Array.from({ length: MAX_PROMPT_TAGS + 1 }, () => 'review')

    expect(tagsOf({ ...base, tags: duplicates })).toEqual(['review'])
  })

  it('refuses more than MAX_PROMPT_TAGS genuinely distinct tags', () => {
    const distinct = Array.from({ length: MAX_PROMPT_TAGS + 1 }, (_, i) => `tag-${i}`)

    expect(createPromptSchema.safeParse({ ...base, tags: distinct }).success).toBe(false)
  })

  it('refuses an array too long to be worth normalising at all', () => {
    // The first cap, which exists for a different reason from the second: an
    // unbounded array is the denial-of-service vector an unbounded string is,
    // and every element being a duplicate does not make parsing it free.
    const flood = Array.from({ length: MAX_PROMPT_TAGS * 4 + 1 }, () => 'review')

    expect(createPromptSchema.safeParse({ ...base, tags: flood }).success).toBe(false)
  })

  it('refuses a single tag longer than the cap', () => {
    expect(
      createPromptSchema.safeParse({
        ...base,
        tags: ['x'.repeat(MAX_PROMPT_TAG_LENGTH + 1)],
      }).success,
    ).toBe(false)
  })

  it('treats a missing tags key as no tags', () => {
    expect(tagsOf(base)).toEqual([])
  })

  it('rejects a title or body that is nothing but whitespace', () => {
    // `.trim()` is declared before `.min(1)`, so these fail rather than being
    // stored as empty strings — a prompt with no name and nothing in it.
    expect(createPromptSchema.safeParse({ ...base, title: '   ' }).success).toBe(false)
    expect(createPromptSchema.safeParse({ ...base, body: '\n\t ' }).success).toBe(false)
  })

  it('accepts a title that is only within the cap once trimmed', () => {
    const padded = `  ${'t'.repeat(MAX_PROMPT_TITLE_LENGTH)}  `
    const parsed = createPromptSchema.safeParse({ ...base, title: padded })

    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.title.length).toBe(MAX_PROMPT_TITLE_LENGTH)
  })

  it('refuses a body over the cap', () => {
    expect(
      createPromptSchema.safeParse({
        ...base,
        body: 'x'.repeat(MAX_PROMPT_BODY_LENGTH + 1),
      }).success,
    ).toBe(false)
  })

  it('refuses a body carrying a stray field', () => {
    // Strict, for the reason every schema in this file is: an ordinary zod
    // object strips what it does not declare, so a client sending `{id}` would
    // be answered as though the id had been understood.
    expect(
      createPromptSchema.safeParse({ ...base, id: crypto.randomUUID() }).success,
    ).toBe(false)
  })
})

/**
 * The one place a client is trusted to describe its own upload. (F29)
 *
 * Everything else on an attachment is measured at confirm — `size_bytes` and
 * `mime_type` are overwritten with what actually landed. These two are not, so
 * the bound is what stops a nonsense figure being stored, and the reason they
 * are allowed through at all is that they are cosmetic: a wrong value costs a
 * layout wobble, not a security claim.
 */
describe('createAttachmentSchema', () => {
  const base = { mimeType: 'image/png' as const, sizeBytes: 1000, withDerivatives: true }

  it('accepts the inline dimensions a derivative can actually have', () => {
    const parsed = createAttachmentSchema.safeParse({
      ...base,
      inlineWidth: 1440,
      inlineHeight: 810,
    })

    expect(parsed.success).toBe(true)
  })

  it('refuses a width beyond the derivative cap', () => {
    // The inline copy is capped at ATTACHMENT_INLINE_MAX_PX by the code that
    // makes it, so anything larger did not come from that code.
    const parsed = createAttachmentSchema.safeParse({ ...base, inlineWidth: 4000 })

    expect(parsed.success).toBe(false)
  })

  it('refuses a zero or negative dimension', () => {
    expect(createAttachmentSchema.safeParse({ ...base, inlineWidth: 0 }).success).toBe(false)
    expect(createAttachmentSchema.safeParse({ ...base, inlineHeight: -1 }).success).toBe(false)
  })

  it('allows them to be absent, which is what a PDF sends', () => {
    const parsed = createAttachmentSchema.safeParse({
      mimeType: 'application/pdf',
      sizeBytes: 1000,
      withDerivatives: false,
    })

    expect(parsed.success).toBe(true)
  })

  it('refuses a PDF that claims derivatives', () => {
    const parsed = createAttachmentSchema.safeParse({
      mimeType: 'application/pdf',
      sizeBytes: 1000,
      withDerivatives: true,
    })

    expect(parsed.success).toBe(false)
  })
})
