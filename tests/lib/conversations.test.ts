import { describe, expect, it } from 'vitest'

import { formatRelativeTime, groupConversations } from '@/lib/conversations'

import type { ConversationSummary } from '@/types/domain'

/**
 * Every assertion here runs against a fixed `now`. The whole reason both
 * functions take it as an argument is that a day boundary tested against the
 * real clock passes or fails depending on when the suite happens to run.
 */
const NOW = new Date('2026-08-01T12:00:00Z')

function conversation(
  overrides: Partial<ConversationSummary> & { id: string },
): ConversationSummary {
  return {
    title: 'A conversation',
    pinned_at: null,
    updated_at: NOW.toISOString(),
    ...overrides,
  }
}

/** The labels present, in the order the sidebar will render them. */
function labelsOf(groups: ReturnType<typeof groupConversations>): string[] {
  return groups.map((group) => group.label)
}

function idsIn(groups: ReturnType<typeof groupConversations>, label: string): string[] {
  const group = groups.find((candidate) => candidate.label === label)
  return group ? group.conversations.map((c) => c.id) : []
}

describe('groupConversations', () => {
  it('files a pinned conversation under Pinned and nowhere else', () => {
    const groups = groupConversations(
      [
        conversation({
          id: 'pinned-today',
          pinned_at: '2026-07-20T09:00:00Z',
          updated_at: '2026-08-01T09:00:00Z',
        }),
      ],
      NOW,
    )

    expect(labelsOf(groups)).toEqual(['Pinned'])
    expect(idsIn(groups, 'Today')).toEqual([])
  })

  it('files a conversation touched earlier the same UTC day under Today', () => {
    const groups = groupConversations(
      [conversation({ id: 'this-morning', updated_at: '2026-08-01T00:14:00Z' })],
      NOW,
    )

    expect(idsIn(groups, 'Today')).toEqual(['this-morning'])
  })

  it('files last night under Previous 7 days, because the day is a UTC day', () => {
    // The accepted cost of grouping in UTC, pinned here deliberately so it
    // registers as a decision rather than surfacing later as a surprise. A user
    // several hours ahead of UTC sees a conversation from "tonight" one group
    // down. The row's own relative time still reads "12 hours ago".
    const lastNight = '2026-07-31T23:59:00Z'

    const groups = groupConversations(
      [conversation({ id: 'last-night', updated_at: lastNight })],
      NOW,
    )

    expect(idsIn(groups, 'Previous 7 days')).toEqual(['last-night'])
    expect(formatRelativeTime(lastNight, NOW)).toBe('12 hours ago')
  })

  it('puts day six in Previous 7 days and day seven in Older', () => {
    const groups = groupConversations(
      [
        conversation({ id: 'day-six', updated_at: '2026-07-26T12:00:00Z' }),
        conversation({ id: 'day-seven', updated_at: '2026-07-25T12:00:00Z' }),
      ],
      NOW,
    )

    expect(idsIn(groups, 'Previous 7 days')).toEqual(['day-six'])
    expect(idsIn(groups, 'Older')).toEqual(['day-seven'])
  })

  it('omits empty groups entirely', () => {
    const groups = groupConversations(
      [conversation({ id: 'old', updated_at: '2020-01-01T00:00:00Z' })],
      NOW,
    )

    expect(labelsOf(groups)).toEqual(['Older'])
  })

  it('returns nothing at all for an empty list', () => {
    expect(groupConversations([], NOW)).toEqual([])
  })

  it('preserves the order the query returned, within each group', () => {
    // listConversations() already sorted by pinned then recency. Re-sorting here
    // would be a second source of truth for the same fact.
    const groups = groupConversations(
      [
        conversation({ id: 'newer', updated_at: '2026-08-01T11:00:00Z' }),
        conversation({ id: 'older', updated_at: '2026-08-01T02:00:00Z' }),
      ],
      NOW,
    )

    expect(idsIn(groups, 'Today')).toEqual(['newer', 'older'])
  })

  it('orders the groups Pinned, Today, Previous 7 days, Older', () => {
    const groups = groupConversations(
      [
        conversation({ id: 'ancient', updated_at: '2024-02-02T00:00:00Z' }),
        conversation({ id: 'today', updated_at: '2026-08-01T01:00:00Z' }),
        conversation({ id: 'pinned', pinned_at: '2026-01-01T00:00:00Z' }),
        conversation({ id: 'recent', updated_at: '2026-07-29T00:00:00Z' }),
      ],
      NOW,
    )

    expect(labelsOf(groups)).toEqual(['Pinned', 'Today', 'Previous 7 days', 'Older'])
  })

  it('treats a future timestamp as today rather than dropping the row', () => {
    // Should not happen, but clock skew between Postgres and the renderer makes
    // it possible, and a conversation vanishing from the sidebar is worse.
    const groups = groupConversations(
      [conversation({ id: 'skewed', updated_at: '2026-08-02T00:00:00Z' })],
      NOW,
    )

    expect(idsIn(groups, 'Today')).toEqual(['skewed'])
  })
})

describe('formatRelativeTime', () => {
  it('says "now" for the last minute', () => {
    expect(formatRelativeTime('2026-08-01T11:59:30Z', NOW)).toBe('now')
  })

  it('counts minutes, then hours, within the first day', () => {
    expect(formatRelativeTime('2026-08-01T11:55:00Z', NOW)).toBe('5 minutes ago')
    expect(formatRelativeTime('2026-08-01T09:00:00Z', NOW)).toBe('3 hours ago')
  })

  it('says "yesterday" rather than "1 day ago"', () => {
    expect(formatRelativeTime('2026-07-31T06:00:00Z', NOW)).toBe('yesterday')
  })

  it('counts days up to a week, then weeks, months, and years', () => {
    expect(formatRelativeTime('2026-07-29T12:00:00Z', NOW)).toBe('3 days ago')
    expect(formatRelativeTime('2026-07-22T12:00:00Z', NOW)).toBe('last week')
    expect(formatRelativeTime('2026-06-17T12:00:00Z', NOW)).toBe('last month')
    expect(formatRelativeTime('2025-01-01T12:00:00Z', NOW)).toBe('last year')
  })
})
