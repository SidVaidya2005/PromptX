/**
 * The sidebar's recency logic, kept pure so it can be tested.
 *
 * Nothing UI-shaped has automated coverage until feature 36 — vitest runs in a
 * node environment against `tests/`, with no jsdom and no component testing
 * library. Grouping and time formatting are the testable residue of this
 * feature, which is why they live here rather than inline in the Server
 * Component that calls them.
 *
 * Both functions take `now` as an argument. That is what makes a boundary case
 * assertable instead of dependent on the clock at the moment the suite runs.
 */

import type {
  ConversationGroup,
  ConversationGroupLabel,
  ConversationSummary,
} from '@/types/domain'

const MS_PER_MINUTE = 60_000
const MS_PER_HOUR = 60 * MS_PER_MINUTE
const MS_PER_DAY = 24 * MS_PER_HOUR

/** "Previous 7 days" covers yesterday through six days back; day seven is Older. */
const RECENT_DAY_LIMIT = 7

const DAYS_PER_WEEK = 7
const DAYS_PER_MONTH = 30
const DAYS_PER_YEAR = 365

/**
 * Constructed once. The process is long-lived on Render, so a module-level
 * formatter is genuinely reused rather than rebuilt per request.
 *
 * The locale is pinned to 'en' rather than left to the runtime default, so the
 * output cannot change with the server's environment. `numeric: 'auto'` is what
 * turns one day back into "yesterday" instead of "1 day ago".
 */
const relativeTime = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

/**
 * Splits ordered conversations into the sidebar's four buckets.
 *
 * The incoming order is preserved inside each bucket — listConversations()
 * already sorted by pinned then recency, and re-sorting here would be a second
 * source of truth for the same fact.
 *
 * Days are UTC calendar days, matching how shared_key_usage.usage_date defines
 * a day everywhere else in the system. The tradeoff is accepted knowingly: a
 * user several hours from UTC can see a conversation from late tonight filed
 * under "Previous 7 days". The per-row relative time still reads correctly, so
 * the group label is the only thing that is off, and only near midnight.
 */
export function groupConversations(
  conversations: readonly ConversationSummary[],
  now: Date,
): ConversationGroup[] {
  const today = utcDayNumber(now)

  // Insertion order is render order. Archived is last because it is the one
  // group the reader has said they are done with. (F22)
  const buckets = new Map<ConversationGroupLabel, ConversationSummary[]>([
    ['Pinned', []],
    ['Today', []],
    ['Previous 7 days', []],
    ['Older', []],
    ['Archived', []],
  ])

  for (const conversation of conversations) {
    buckets.get(labelFor(conversation, today))?.push(conversation)
  }

  return [...buckets.entries()]
    .filter(([, group]) => group.length > 0)
    .map(([label, group]) => ({ label, conversations: group }))
}

/**
 * How long ago a conversation was last touched, as "yesterday" or "3 hours ago".
 *
 * Under a day this is elapsed time; past that it is the same UTC calendar-day
 * difference the grouping uses, so a row never reads "2 days ago" while sitting
 * under a heading that disagrees.
 */
export function formatRelativeTime(iso: string, now: Date): string {
  const elapsed = now.getTime() - new Date(iso).getTime()

  if (elapsed < MS_PER_MINUTE) return relativeTime.format(0, 'second')
  if (elapsed < MS_PER_HOUR) {
    return relativeTime.format(-Math.floor(elapsed / MS_PER_MINUTE), 'minute')
  }
  if (elapsed < MS_PER_DAY) {
    return relativeTime.format(-Math.floor(elapsed / MS_PER_HOUR), 'hour')
  }

  const days = utcDayNumber(now) - utcDayNumber(new Date(iso))

  if (days < DAYS_PER_MONTH) {
    return days < DAYS_PER_WEEK
      ? relativeTime.format(-days, 'day')
      : relativeTime.format(-Math.floor(days / DAYS_PER_WEEK), 'week')
  }

  return days < DAYS_PER_YEAR
    ? relativeTime.format(-Math.floor(days / DAYS_PER_MONTH), 'month')
    : relativeTime.format(-Math.floor(days / DAYS_PER_YEAR), 'year')
}

function labelFor(
  conversation: ConversationSummary,
  today: number,
): ConversationGroupLabel {
  // Archived is checked before Pinned, and the order is the decision rather
  // than an accident of writing. Archiving does not clear `pinned_at` — so
  // unarchiving can put the row back exactly where it was — which means a row
  // can be both, and only one of them can be its group. Put away wins over
  // lifted up: a conversation the user has filed away should not reappear at
  // the top of the sidebar the moment archived rows are revealed. (F22)
  if (conversation.archived_at !== null) return 'Archived'

  // Pinned is exclusive too: a pinned conversation updated this morning belongs
  // under Pinned only, never in two places at once.
  if (conversation.pinned_at !== null) return 'Pinned'

  const days = today - utcDayNumber(new Date(conversation.updated_at))

  // A future timestamp should not exist, but clock skew between Postgres and
  // the renderer makes it possible. Treating it as today beats dropping it.
  if (days <= 0) return 'Today'
  if (days < RECENT_DAY_LIMIT) return 'Previous 7 days'

  return 'Older'
}

/** Days since the epoch in UTC, which makes a calendar-day difference subtraction. */
function utcDayNumber(date: Date): number {
  return Math.floor(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / MS_PER_DAY,
  )
}
