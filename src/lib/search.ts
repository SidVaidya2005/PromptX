/**
 * The search page's derivations, kept pure so they can be tested. (F27)
 *
 * `vitest.config.ts` matches `tests/**` in a node environment and can see
 * nothing rendered, so a pure helper is the only part of a UI feature that has
 * automated coverage before F36 — the split F05 established and every UI
 * feature since has reused.
 *
 * Both functions here are presentation. Neither re-ranks: F26's function
 * already decided the order, and a second opinion about relevance living in the
 * browser is exactly the kind of duplicated rule F15 forbids.
 */

import { SEARCH_MATCH_END, SEARCH_MATCH_START } from '@/lib/constants'

import type { SearchResult } from '@/types/domain'

/** One run of snippet text, and whether it is part of the match. */
export type SnippetSegment = {
  text: string
  isMatch: boolean
}

/**
 * A snippet split into the runs a renderer turns into `<mark>` elements. (F27)
 *
 * **This is the function that makes "only `<mark>` is permitted, never
 * arbitrary HTML" true.** F26's `ts_headline` delimits matches with control
 * characters precisely so that no HTML string ever exists: the snippet arrives
 * as plain text, this splits it into runs, and the component wraps the matched
 * runs in real React elements. Nothing is ever parsed as markup, so a message
 * containing `<img src=x onerror=…>` renders as those characters — visible,
 * inert, and exactly what the user wrote.
 *
 * An unmatched sentinel is treated as ordinary text rather than an error. The
 * database always emits them in pairs; if that ever stopped being true the right
 * failure is a stray character on screen, not a thrown renderer.
 */
export function toSnippetSegments(snippet: string): SnippetSegment[] {
  const segments: SnippetSegment[] = []
  let rest = snippet

  while (rest.length > 0) {
    const start = rest.indexOf(SEARCH_MATCH_START)

    if (start === -1) {
      segments.push({ text: rest, isMatch: false })
      break
    }

    const end = rest.indexOf(SEARCH_MATCH_END, start)

    if (end === -1) {
      // An opener with no closer. Everything from here is plain text.
      segments.push({ text: rest, isMatch: false })
      break
    }

    if (start > 0) {
      segments.push({ text: rest.slice(0, start), isMatch: false })
    }

    segments.push({
      text: rest.slice(start + SEARCH_MATCH_START.length, end),
      isMatch: true,
    })

    rest = rest.slice(end + SEARCH_MATCH_END.length)
  }

  // Empty runs are dropped rather than rendered as empty elements: a match at
  // the very start or end of a snippet would otherwise bracket nothing.
  return segments.filter((segment) => segment.text !== '')
}

/** Every hit from one conversation, in the order the ranking put them. */
export type SearchResultGroup = {
  conversationId: string
  conversationTitle: string
  results: SearchResult[]
}

/**
 * Results gathered by conversation, without disturbing the ranking. (F27)
 *
 * **Grouping is presentation, never a second opinion about relevance.** A group
 * takes the position of its best-ranked hit — which, because the input arrives
 * already ordered, is simply the position of the first hit that named that
 * conversation — and hits inside it keep their own order. Sorting groups by
 * size, or by recency, would quietly overrule the `ts_rank` ordering F26 exists
 * to produce.
 *
 * Note what this cannot fix: F26 caps at 30 hits *before* anything groups them,
 * so one conversation holding the 30 best matches produces exactly one group.
 * That is the honest answer to the query rather than a bug, and it is recorded
 * as a known limit in `build-plan.md` §27.
 */
export function groupSearchResults(
  results: readonly SearchResult[],
): SearchResultGroup[] {
  const groups = new Map<string, SearchResultGroup>()

  for (const result of results) {
    const existing = groups.get(result.conversation_id)

    if (existing) {
      existing.results.push(result)
      continue
    }

    // A Map iterates in insertion order, which is what makes "the position of
    // its best hit" fall out of the input's order rather than needing a sort.
    groups.set(result.conversation_id, {
      conversationId: result.conversation_id,
      conversationTitle: result.conversation_title,
      results: [result],
    })
  }

  return [...groups.values()]
}
