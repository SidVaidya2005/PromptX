import { describe, expect, it } from 'vitest'

import { SEARCH_MATCH_END, SEARCH_MATCH_START } from '@/lib/constants'
import { groupSearchResults, toSnippetSegments } from '@/lib/search'

import type { SearchResult } from '@/types/domain'

/** Builds the snippet shape `ts_headline` produces, without the invisible characters. */
function snippet(...parts: (string | { match: string })[]): string {
  return parts
    .map((part) =>
      typeof part === 'string'
        ? part
        : `${SEARCH_MATCH_START}${part.match}${SEARCH_MATCH_END}`,
    )
    .join('')
}

function resultOf(overrides: Partial<SearchResult>): SearchResult {
  return {
    message_id: crypto.randomUUID(),
    conversation_id: crypto.randomUUID(),
    conversation_title: 'Untitled',
    role: 'user',
    snippet: 'a snippet',
    rank: 0.5,
    created_at: '2026-08-08T00:00:00.000Z',
    ...overrides,
  }
}

describe('toSnippetSegments', () => {
  it('splits a match out of the surrounding text', () => {
    expect(toSnippetSegments(snippet('what is the ', { match: 'capital' }, ' of France'))).toEqual(
      [
        { text: 'what is the ', isMatch: false },
        { text: 'capital', isMatch: true },
        { text: ' of France', isMatch: false },
      ],
    )
  })

  it('handles several matches in one snippet', () => {
    const segments = toSnippetSegments(
      snippet({ match: 'capital' }, ' of ', { match: 'France' }),
    )

    expect(segments.filter((segment) => segment.isMatch).map((s) => s.text)).toEqual([
      'capital',
      'France',
    ])
  })

  it('returns a snippet with no match as one plain segment', () => {
    expect(toSnippetSegments('nothing highlighted here')).toEqual([
      { text: 'nothing highlighted here', isMatch: false },
    ])
  })

  it('returns nothing for an empty snippet', () => {
    expect(toSnippetSegments('')).toEqual([])
  })

  it('drops empty runs rather than rendering empty elements', () => {
    // A match at the very start brackets nothing before it.
    expect(toSnippetSegments(snippet({ match: 'lead' }, ' and the rest'))).toEqual([
      { text: 'lead', isMatch: true },
      { text: ' and the rest', isMatch: false },
    ])
  })

  it('keeps HTML in a message as ordinary text', () => {
    // The whole reason F26 chose sentinels over <mark>. ts_headline does not
    // escape the document, so this string really can arrive from the database —
    // and it must reach the screen as characters, never as markup.
    const raw = snippet('an <img src=x onerror=alert(1)> tag near ', { match: 'zylophone' })
    const segments = toSnippetSegments(raw)

    expect(segments[0]).toEqual({
      text: 'an <img src=x onerror=alert(1)> tag near ',
      isMatch: false,
    })
    expect(segments[1]).toEqual({ text: 'zylophone', isMatch: true })
  })

  it('treats an unmatched opener as plain text rather than throwing', () => {
    // The database always emits pairs. If that stops being true, a stray
    // character on screen is the right failure; a thrown renderer is not.
    const segments = toSnippetSegments(`before ${SEARCH_MATCH_START}after`)

    expect(segments).toHaveLength(1)
    expect(segments[0]?.isMatch).toBe(false)
  })
})

describe('groupSearchResults', () => {
  const alpha = 'aaaaaaaa-0000-4000-8000-000000000001'
  const beta = 'bbbbbbbb-0000-4000-8000-000000000002'

  it('gathers hits from one conversation into a single group', () => {
    const groups = groupSearchResults([
      resultOf({ conversation_id: alpha, conversation_title: 'Alpha' }),
      resultOf({ conversation_id: alpha, conversation_title: 'Alpha' }),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0]?.results).toHaveLength(2)
    expect(groups[0]?.conversationTitle).toBe('Alpha')
  })

  it('orders groups by their best hit, not by size', () => {
    // Beta's single hit outranks both of Alpha's, so Beta leads. A grouping
    // that sorted by count would put Alpha first and quietly overrule ts_rank.
    const groups = groupSearchResults([
      resultOf({ conversation_id: beta, conversation_title: 'Beta', rank: 0.9 }),
      resultOf({ conversation_id: alpha, conversation_title: 'Alpha', rank: 0.5 }),
      resultOf({ conversation_id: alpha, conversation_title: 'Alpha', rank: 0.4 }),
    ])

    expect(groups.map((group) => group.conversationTitle)).toEqual(['Beta', 'Alpha'])
  })

  it('keeps hits inside a group in the order they arrived', () => {
    const first = resultOf({ conversation_id: alpha, rank: 0.9 })
    const second = resultOf({ conversation_id: alpha, rank: 0.2 })

    expect(groupSearchResults([first, second])[0]?.results).toEqual([first, second])
  })

  it('interleaved conversations still produce one group each', () => {
    const groups = groupSearchResults([
      resultOf({ conversation_id: alpha, conversation_title: 'Alpha' }),
      resultOf({ conversation_id: beta, conversation_title: 'Beta' }),
      resultOf({ conversation_id: alpha, conversation_title: 'Alpha' }),
    ])

    expect(groups.map((group) => group.conversationTitle)).toEqual(['Alpha', 'Beta'])
    expect(groups[0]?.results).toHaveLength(2)
    expect(groups[1]?.results).toHaveLength(1)
  })

  it('returns nothing for no results', () => {
    expect(groupSearchResults([])).toEqual([])
  })
})
