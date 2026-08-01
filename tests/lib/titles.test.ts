import { describe, expect, it } from 'vitest'

import { MAX_TITLE_LENGTH } from '@/lib/constants'
import { normalizeTitle } from '@/lib/titles'

/**
 * Everything asserted here is something a model has a real habit of doing when
 * asked for a title, however clearly the prompt says not to. The prompt asks;
 * this is what enforces.
 */
describe('normalizeTitle', () => {
  it('keeps a title that already arrived clean', () => {
    expect(normalizeTitle('Fixing the flaky auth test')).toBe('Fixing the flaky auth test')
  })

  it('strips the quotes a model wraps a title in', () => {
    expect(normalizeTitle('"Fixing the flaky auth test"')).toBe(
      'Fixing the flaky auth test',
    )
    expect(normalizeTitle("'Fixing the flaky auth test'")).toBe(
      'Fixing the flaky auth test',
    )
    expect(normalizeTitle('`Fixing the flaky auth test`')).toBe(
      'Fixing the flaky auth test',
    )
  })

  it('strips curly quotes, which a model reaches for even in plain ASCII text', () => {
    expect(normalizeTitle('“Fixing the flaky auth test”')).toBe(
      'Fixing the flaky auth test',
    )
    expect(normalizeTitle('‘Fixing the flaky auth test’')).toBe(
      'Fixing the flaky auth test',
    )
  })

  it('strips quotes that were applied twice', () => {
    expect(normalizeTitle('"“Fixing the flaky auth test”"')).toBe(
      'Fixing the flaky auth test',
    )
  })

  it('strips trailing punctuation', () => {
    expect(normalizeTitle('Fixing the flaky auth test.')).toBe(
      'Fixing the flaky auth test',
    )
    expect(normalizeTitle('Fixing the flaky auth test?')).toBe(
      'Fixing the flaky auth test',
    )
    expect(normalizeTitle('Fixing the flaky auth test…')).toBe(
      'Fixing the flaky auth test',
    )
  })

  it('unwraps a title whose punctuation sits outside its quotes', () => {
    // Needs quote-stripping and punctuation-stripping to alternate. Running
    // either one once, in either order, leaves the other's work undone.
    expect(normalizeTitle('"Fixing the flaky auth test".')).toBe(
      'Fixing the flaky auth test',
    )
  })

  it('collapses newlines and runs of whitespace into single spaces', () => {
    expect(normalizeTitle('  Fixing the\n\n  flaky   auth test \n')).toBe(
      'Fixing the flaky auth test',
    )
  })

  it('returns null when nothing usable survives', () => {
    expect(normalizeTitle('')).toBeNull()
    expect(normalizeTitle('   \n  ')).toBeNull()
    expect(normalizeTitle('"..."')).toBeNull()
  })

  it('keeps a title of exactly the maximum length', () => {
    const exact = 'a'.repeat(MAX_TITLE_LENGTH)

    expect(exact).toHaveLength(MAX_TITLE_LENGTH)
    expect(normalizeTitle(exact)).toBe(exact)
  })

  it('truncates an over-long title on a word boundary', () => {
    const long =
      'Debugging the intermittent authentication failure in the staging environment'
    const title = normalizeTitle(long)

    expect(title).not.toBeNull()
    expect(title?.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH)
    // Cut between words, so the stored value never ends mid-word.
    expect(long.startsWith(title ?? '')).toBe(true)
    expect(title?.endsWith(' ')).toBe(false)
    expect(long.charAt(title?.length ?? 0)).toBe(' ')
  })

  it('truncates mid-word rather than to almost nothing', () => {
    // The only space is at index 1, so honouring the word boundary would store
    // the single letter "a". The floor is what stops that.
    const long = `a ${'b'.repeat(MAX_TITLE_LENGTH * 2)}`
    const title = normalizeTitle(long)

    expect(title).toHaveLength(MAX_TITLE_LENGTH)
  })

  it('leaves no trailing punctuation behind after truncating', () => {
    // The cut lands immediately after the comma.
    const long = `${'a'.repeat(MAX_TITLE_LENGTH - 1)}, and then some more words`
    const title = normalizeTitle(long)

    expect(title).toBe('a'.repeat(MAX_TITLE_LENGTH - 1))
  })
})
