import { describe, expect, it } from 'vitest'

import { MAX_PROMPT_TAG_LENGTH, PROMPT_BODY_PREVIEW_LENGTH } from '@/lib/constants'
import {
  collectTags,
  filterPrompts,
  insertPromptAt,
  normalizeTagInput,
  promptBodyPreview,
  searchPrompts,
} from '@/lib/prompts'

import type { Prompt } from '@/types/domain'

function promptOf(overrides: Partial<Prompt>): Prompt {
  return {
    id: crypto.randomUUID(),
    user_id: crypto.randomUUID(),
    title: 'Untitled',
    body: 'Body',
    tags: [],
    created_at: '2026-08-08T00:00:00.000Z',
    updated_at: '2026-08-08T00:00:00.000Z',
    ...overrides,
  }
}

describe('promptBodyPreview', () => {
  it('collapses whitespace so a prompt written as a list is not a blank card', () => {
    // The failure this exists to prevent: a body beginning with a newline
    // slices to a string of spaces, and the card looks like it has no content.
    expect(promptBodyPreview('\n\n  Review this diff.\n  Be terse.  ')).toBe(
      'Review this diff. Be terse.',
    )
  })

  it('leaves a short body alone, with no ellipsis', () => {
    expect(promptBodyPreview('Short.')).toBe('Short.')
  })

  it('truncates a long body to the cap and marks the cut', () => {
    const preview = promptBodyPreview('x'.repeat(PROMPT_BODY_PREVIEW_LENGTH + 50))

    // The ellipsis is one character, so the rendered string is cap + 1.
    expect(preview).toHaveLength(PROMPT_BODY_PREVIEW_LENGTH + 1)
    expect(preview.endsWith('…')).toBe(true)
  })

  it('does not truncate a body that is exactly the cap', () => {
    const body = 'x'.repeat(PROMPT_BODY_PREVIEW_LENGTH)

    expect(promptBodyPreview(body)).toBe(body)
  })
})

describe('collectTags', () => {
  it('returns each tag once, alphabetically', () => {
    const prompts = [
      promptOf({ tags: ['review', 'code'] }),
      promptOf({ tags: ['code', 'writing'] }),
      promptOf({ tags: [] }),
    ]

    expect(collectTags(prompts)).toEqual(['code', 'review', 'writing'])
  })

  it('returns nothing for a library with no tags at all', () => {
    expect(collectTags([promptOf({}), promptOf({})])).toEqual([])
  })
})

describe('filterPrompts', () => {
  const review = promptOf({ title: 'Code review', tags: ['code'] })
  const email = promptOf({ title: 'Polite email', tags: ['writing'] })
  const commit = promptOf({ title: 'Commit message', tags: ['code', 'writing'] })
  const library = [review, email, commit]

  it('returns everything when nothing is asked for', () => {
    expect(filterPrompts(library, { query: '', tag: null })).toEqual(library)
  })

  it('matches a title regardless of case', () => {
    expect(filterPrompts(library, { query: 'CODE', tag: null })).toEqual([review])
  })

  it('matches a substring anywhere in the title', () => {
    expect(filterPrompts(library, { query: 'mess', tag: null })).toEqual([commit])
  })

  it('ignores a query that is only whitespace', () => {
    expect(filterPrompts(library, { query: '   ', tag: null })).toEqual(library)
  })

  it('does not match the body', () => {
    // Narrower than it looks, and deliberate: matching bodies here would be a
    // worse version of F26's ranked message search, and the same word would
    // find a prompt in one place and not the other.
    const hidden = promptOf({ title: 'Nothing', body: 'a rare word: xylophone' })

    expect(filterPrompts([hidden], { query: 'xylophone', tag: null })).toEqual([])
  })

  it('filters to a single tag', () => {
    expect(filterPrompts(library, { query: '', tag: 'writing' })).toEqual([email, commit])
  })

  it('ANDs the tag and the query', () => {
    expect(filterPrompts(library, { query: 'commit', tag: 'writing' })).toEqual([commit])
    expect(filterPrompts(library, { query: 'commit', tag: 'nonexistent' })).toEqual([])
  })

  it('returns nothing rather than everything when a tag matches no prompt', () => {
    // The direction that matters: a filter that failed open would show the
    // whole library under a tag that nothing carries.
    expect(filterPrompts(library, { query: '', tag: 'archived' })).toEqual([])
  })
})

describe('normalizeTagInput', () => {
  it('lowercases and trims, agreeing with the schema', () => {
    expect(normalizeTagInput('  Review  ')).toBe('review')
  })

  it('returns null for nothing worth committing', () => {
    expect(normalizeTagInput('')).toBeNull()
    expect(normalizeTagInput('   ')).toBeNull()
  })

  it('truncates rather than refusing an over-long tag', () => {
    // A person is still typing. Refusing the keystroke that crosses the cap
    // reads as a broken field; the schema is what enforces the bound on save.
    expect(normalizeTagInput('x'.repeat(MAX_PROMPT_TAG_LENGTH + 10))).toHaveLength(
      MAX_PROMPT_TAG_LENGTH,
    )
  })
})

/**
 * The picker's search is deliberately NOT `filterPrompts`, and the pair of
 * suites is what keeps that a decision rather than a drift. `/prompts` has a row
 * of tag chips beside its search box; the picker has no room for one, so a tag
 * either folds into the query here or is unreachable from the composer.
 */
describe('searchPrompts', () => {
  const review = promptOf({ title: 'Code review', tags: ['engineering'] })
  const email = promptOf({ title: 'Polite email', tags: ['writing'] })
  const library = [review, email]

  it('returns everything for an empty query', () => {
    expect(searchPrompts(library, '')).toEqual(library)
    expect(searchPrompts(library, '   ')).toEqual(library)
  })

  it('matches a title regardless of case', () => {
    expect(searchPrompts(library, 'POLITE')).toEqual([email])
  })

  it('matches a tag, which is the whole difference from the page filter', () => {
    expect(searchPrompts(library, 'engineering')).toEqual([review])
    // The same query against the page's filter finds nothing, because there the
    // tag chips are a separate control. Asserted here so the two rules are
    // visibly different on purpose.
    expect(filterPrompts(library, { query: 'engineering', tag: null })).toEqual([])
  })

  it('matches a partial tag', () => {
    expect(searchPrompts(library, 'writ')).toEqual([email])
  })

  it('does not match the body', () => {
    // Same reason filterPrompts does not: a common word is in most bodies, so
    // the list would stop narrowing exactly when someone types to narrow it.
    const hidden = promptOf({ title: 'Nothing', body: 'a rare word: xylophone' })

    expect(searchPrompts([hidden], 'xylophone')).toEqual([])
  })

  it('returns a copy, never the array it was given', () => {
    // The picker holds the result in state and the cache holds the input. One
    // array shared between them would let a sort in the panel reorder the cache.
    const result = searchPrompts(library, '')

    expect(result).not.toBe(library)
  })
})

describe('insertPromptAt', () => {
  it('inserts at the caret rather than at the end', () => {
    const { text, caret } = insertPromptAt('A  B', 2, 2, 'X')

    expect(text).toBe('A X B')
    expect(caret).toBe(3)
  })

  it('replaces a selection', () => {
    expect(insertPromptAt('keep DROP keep', 5, 9, 'X').text).toBe('keep X keep')
  })

  it('adds nothing to an empty draft', () => {
    const { text, caret } = insertPromptAt('', 0, 0, 'Review this diff.')

    expect(text).toBe('Review this diff.')
    expect(caret).toBe(17)
  })

  it('separates from a word it would otherwise run into', () => {
    // The failure this exists to prevent: 'explain thisReview this diff'.
    expect(insertPromptAt('explain this', 12, 12, 'Review').text).toBe(
      'explain this\nReview',
    )
  })

  it('separates on both sides when dropped between two words', () => {
    // No space in the fixture, deliberately. 'before after' with the caret at 6
    // sits *before* the space, so only the leading side needs a separator — the
    // first version of this test asserted two and was wrong about its own
    // fixture rather than about the code.
    expect(insertPromptAt('beforeafter', 6, 6, 'X').text).toBe('before\nX\nafter')
  })

  it('adds only the separator that is missing', () => {
    expect(insertPromptAt('before after', 6, 6, 'X').text).toBe('before\nX after')
  })

  it('adds no separator when the neighbouring character is already whitespace', () => {
    expect(insertPromptAt('before ', 7, 7, 'X').text).toBe('before X')
    expect(insertPromptAt('before\n', 7, 7, 'X').text).toBe('before\nX')
  })

  it('leaves the caret after the body, not after a trailing separator', () => {
    // So typing continues where the reader is looking rather than a line below.
    const { text, caret } = insertPromptAt('beforeafter', 6, 6, 'X')

    expect(text.slice(0, caret)).toBe('before\nX')
  })

  it('inserts a multi-line body verbatim', () => {
    const body = 'Line one.\nLine two.'

    expect(insertPromptAt('', 0, 0, body).text).toBe(body)
  })
})
