import { searchMessages } from '@/server/data/messages'

import { SearchInput } from '@/components/search/SearchInput'
import { SearchResults } from '@/components/search/SearchResults'

type SearchPageProps = {
  /** A Promise in Next 16 — the synchronous fallback 15 allowed is gone. */
  searchParams: Promise<{ q?: string }>
}

/**
 * Ranked search across everything the caller has ever sent or received. (F27)
 *
 * **The URL is the state**, which is what §27 asks for and what makes a result
 * page linkable: `/search?q=deploy` is a complete description of what is on
 * screen. The input is the only client component here, and all it does is write
 * that URL after a pause.
 *
 * A Server Component calling `searchMessages()` directly rather than a route
 * handler — the boundary rule pages follow everywhere else, and the reason F26
 * built no `GET /api/search`.
 *
 * Three empty states, not the two §27 names. F26 distinguishes "this query had
 * nothing searchable in it" from "we looked and found nothing", and collapsing
 * them would tell someone their history is empty when what happened is that
 * they searched for `the and of`.
 */
export default async function SearchPage({ searchParams }: SearchPageProps) {
  const { q } = await searchParams
  const query = q?.trim() ?? ''

  const outcome = query === '' ? null : await searchMessages(query)

  // One instant for every row, taken here rather than per row, so a long result
  // list cannot describe two different "now"s.
  const now = new Date()

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-180 px-lg py-xl tablet:px-xl">
        <h1 className="text-display-md text-ink">Search</h1>

        <div className="mt-lg">
          <SearchInput query={query} />
        </div>

        {outcome === null ? (
          <EmptyState
            title="Search your conversations"
            body="Every message you have sent and every answer you have received, ranked by how well it matches."
          />
        ) : outcome.status === 'no_terms' ? (
          // The third state, and the one that would otherwise read as a broken
          // search: `the and of` parses to an empty query, so nothing was ever
          // looked for. Saying "no matches" here would be untrue.
          <EmptyState
            title="Nothing to search for"
            body="Those are all very common words, so there was nothing specific to look for. Try a word that would appear in the message you want."
          />
        ) : outcome.results.length === 0 ? (
          <EmptyState
            title="No matches"
            body={`Nothing in your conversations mentions “${query}”.`}
          />
        ) : (
          <SearchResults results={outcome.results} now={now} />
        )}
      </div>
    </div>
  )
}

type EmptyStateProps = {
  title: string
  body: string
}

/**
 * DESIGN.md `empty-state`: no fill, no border, mute text, centred, one sentence
 * and at most one action. There is no action on any of the three here — the
 * thing to do next is type in the field directly above, and a button pointing
 * at it would be chrome explaining chrome.
 */
function EmptyState({ title, body }: EmptyStateProps) {
  return (
    <div className="mt-xl flex flex-col items-center gap-md px-lg py-3xl text-center">
      <p className="text-body-md text-mute">{title}</p>
      <p className="max-w-120 text-body-sm text-mute">{body}</p>
    </div>
  )
}
