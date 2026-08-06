import { describe, expect, it } from 'vitest'

import { OUTLINE_ENTRY_CHAR_LIMIT, OUTLINE_MIN_EXCHANGES } from '@/lib/constants'
import type { ChatMessage } from '@/lib/messages'
import { isOutlineVisible, outlineAnchorId, toOutlineEntries } from '@/lib/outline'

/**
 * A thread message, with only the fields the outline actually reads.
 *
 * Built here rather than through `toUIMessages` because these tests are about
 * the derivation, not about the database mapping — a fixture that went through
 * the row shape would couple them to a schema this feature does not touch.
 */
function message(
  id: string,
  role: 'user' | 'assistant',
  ...texts: string[]
): ChatMessage {
  return {
    id,
    role,
    metadata: { status: 'complete', errorMessage: null, modelId: null },
    parts: texts.map((text) => ({ type: 'text' as const, text })),
  }
}

describe('toOutlineEntries', () => {
  it('keeps the user prompts and drops the answers', () => {
    const entries = toOutlineEntries([
      message('a', 'user', 'first question'),
      message('b', 'assistant', 'first answer'),
      message('c', 'user', 'second question'),
      message('d', 'assistant', 'second answer'),
    ])

    expect(entries).toEqual([
      { id: 'a', label: 'first question' },
      { id: 'c', label: 'second question' },
    ])
  })

  it('preserves thread order', () => {
    const entries = toOutlineEntries([
      message('one', 'user', '1'),
      message('two', 'user', '2'),
      message('three', 'user', '3'),
    ])

    expect(entries.map((entry) => entry.id)).toEqual(['one', 'two', 'three'])
  })

  it('joins a multi-part message into a single label', () => {
    const entries = toOutlineEntries([message('a', 'user', 'hello ', 'there')])

    expect(entries).toHaveLength(1)
    expect(entries[0]?.label).toBe('hello there')
  })

  // The rail clamps to two lines, so a prompt opening with a blank line would
  // otherwise spend one of them rendering nothing.
  it('collapses newlines and runs of whitespace to single spaces', () => {
    const entries = toOutlineEntries([
      message('a', 'user', '\n\n  why does   this\nfail?\t\n'),
    ])

    expect(entries[0]?.label).toBe('why does this fail?')
  })

  it('cuts a label to the character budget and leaves a short one alone', () => {
    const long = 'x'.repeat(OUTLINE_ENTRY_CHAR_LIMIT + 50)
    const short = 'still short'

    const entries = toOutlineEntries([
      message('long', 'user', long),
      message('short', 'user', short),
    ])

    expect(entries[0]?.label).toHaveLength(OUTLINE_ENTRY_CHAR_LIMIT)
    expect(entries[1]?.label).toBe(short)
  })

  // The clamp draws its own ellipsis for text that overflows visually. A second
  // one for text cut by the budget would show two truncation marks for one idea.
  it('appends no ellipsis of its own', () => {
    const entries = toOutlineEntries([
      message('a', 'user', 'y'.repeat(OUTLINE_ENTRY_CHAR_LIMIT + 1)),
    ])

    expect(entries[0]?.label.endsWith('…')).toBe(false)
    expect(entries[0]?.label.endsWith('...')).toBe(false)
  })

  // An empty prompt still occupies a real position in the thread. Dropping it
  // would leave a jump target missing with nothing on screen to explain the gap.
  it('keeps a user message whose content is empty', () => {
    const entries = toOutlineEntries([message('a', 'user', '')])

    expect(entries).toEqual([{ id: 'a', label: '' }])
  })

  it('returns nothing for an empty thread or an assistant-only one', () => {
    expect(toOutlineEntries([])).toEqual([])
    expect(toOutlineEntries([message('a', 'assistant', 'hi')])).toEqual([])
  })
})

/**
 * The threshold decides whether the entire right column exists — the aside, the
 * collapsed gutter, and the mobile trigger are gated on this one answer.
 */
describe('isOutlineVisible', () => {
  it('is false below the threshold and true at it', () => {
    expect(isOutlineVisible(0)).toBe(false)
    expect(isOutlineVisible(1)).toBe(false)
    expect(isOutlineVisible(2)).toBe(false)
    expect(isOutlineVisible(OUTLINE_MIN_EXCHANGES)).toBe(true)
  })

  it('stays true above the threshold', () => {
    expect(isOutlineVisible(OUTLINE_MIN_EXCHANGES + 1)).toBe(true)
    expect(isOutlineVisible(200)).toBe(true)
  })
})

/**
 * A mismatch between the anchor written onto a message and the one a jump looks
 * up does not throw — it silently makes every jump a no-op. One spelling is what
 * prevents that, so this pins the spelling rather than merely its shape.
 */
describe('outlineAnchorId', () => {
  it('derives a stable id from the message id', () => {
    const id = crypto.randomUUID()

    expect(outlineAnchorId(id)).toBe(`message-${id}`)
    expect(outlineAnchorId(id)).toBe(outlineAnchorId(id))
  })

  it('gives two messages two different anchors', () => {
    expect(outlineAnchorId('a')).not.toBe(outlineAnchorId('b'))
  })
})
