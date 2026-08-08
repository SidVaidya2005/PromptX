import Link from 'next/link'

import { JUMP_TO_MESSAGE_PARAM } from '@/lib/constants'
import { formatRelativeTime } from '@/lib/conversations'
import { groupSearchResults, toSnippetSegments } from '@/lib/search'

import type { SearchResult } from '@/types/domain'

type SearchResultsProps = {
  results: readonly SearchResult[]
  /** Passed in so every row formats against one instant. */
  now: Date
}

/**
 * The ranked matches, gathered by conversation. (F27)
 *
 * A Server Component: it renders text and links and needs no browser state at
 * all, so none of this ships to the client. The relative times are formatted
 * here for the reason F13 formats dates server-side — a value derived from the
 * clock, computed twice, is a hydration mismatch waiting to happen.
 *
 * Grouping is `groupSearchResults`, which preserves the ranking rather than
 * re-sorting. What it cannot fix is that F26 caps at 30 hits *before* grouping,
 * so a conversation holding the 30 best matches produces exactly one group —
 * the honest answer to that query, recorded as a known limit in §27.
 */
export function SearchResults({ results, now }: SearchResultsProps) {
  const groups = groupSearchResults(results)

  return (
    <div className="mt-xl flex flex-col gap-2xl">
      {groups.map((group) => (
        <section key={group.conversationId}>
          <h2 className="text-body-sm-strong text-ink">{group.conversationTitle}</h2>

          <ul>
            {group.results.map((result) => (
              <SearchResultRow key={result.message_id} result={result} now={now} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

type SearchResultRowProps = {
  result: SearchResult
  now: Date
}

/**
 * One message match.
 *
 * DESIGN.md `search-result-row`: no fill, a bottom hairline, `body-sm` in
 * `body`, and matched terms lifted with **weight and brightness rather than a
 * background** — a yellow highlight would introduce a chromatic accent the
 * system does not have.
 *
 * The whole row is a link to the conversation, carrying the message id in
 * `?m=`. That is what makes "clicking a result opens the conversation scrolled
 * to that message" work: the page reads the param and `Chat` runs F18's
 * `jumpTo`, which also flashes the message so it announces itself.
 */
function SearchResultRow({ result, now }: SearchResultRowProps) {
  const segments = toSnippetSegments(result.snippet)

  return (
    <li className="border-b border-hairline last:border-b-0">
      <Link
        href={`/chat/${result.conversation_id}?${JUMP_TO_MESSAGE_PARAM}=${result.message_id}`}
        className="flex flex-col gap-xs py-lg transition-colors hover:text-ink"
      >
        <div className="flex items-baseline justify-between gap-md">
          <span className="text-caption text-mute">
            {result.role === 'user' ? 'You' : 'Assistant'}
          </span>

          {/* datetime carries the machine-readable value, the way the sidebar's
              rows do, so the relative phrasing is never the only record. */}
          <time dateTime={result.created_at} className="shrink-0 text-caption text-mute">
            {formatRelativeTime(result.created_at, now)}
          </time>
        </div>

        {/* Every segment is text and every match is a real element. Nothing here
            parses markup, which is the whole reason F26 delimits matches with
            control characters instead of emitting <mark> itself — a message
            containing an <img onerror> renders as those characters. */}
        <p className="text-body-sm text-body">
          {segments.map((segment, index) =>
            segment.isMatch ? (
              <mark
                key={index}
                className="bg-transparent font-medium text-ink"
              >
                {segment.text}
              </mark>
            ) : (
              <span key={index}>{segment.text}</span>
            ),
          )}
        </p>
      </Link>
    </li>
  )
}
