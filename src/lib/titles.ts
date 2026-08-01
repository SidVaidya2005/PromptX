/**
 * Turning whatever the titling model returned into something the sidebar can
 * show, kept pure so it can be tested.
 *
 * A model asked for a title will, sooner or later, return every one of these:
 * `"Fixing the flaky test"`, `Fixing the flaky test.`, a leading newline, a
 * sentence far past the sidebar's width, or nothing at all. None of that is an
 * error worth surfacing, so it is all normalised here rather than guarded
 * against in the prompt — a prompt is a request, not a constraint.
 *
 * Nothing UI-shaped has automated coverage until feature 36, so this is the
 * testable residue of feature 10, following the same split as
 * `src/lib/conversations.ts`.
 */

import { MAX_TITLE_LENGTH } from '@/lib/constants'

/**
 * Both curly forms are here because a model writing prose reaches for them even
 * when the surrounding text is plain ASCII, and a backtick shows up whenever it
 * decides a title is a code-ish identifier.
 */
const OPENING_QUOTES = '"\'`“‘'
const CLOSING_QUOTES = '"\'`”’'

const TRAILING_PUNCTUATION = /[.,;:!?…]+$/

/**
 * The title as it should be stored, or null when nothing usable survived.
 *
 * Null is the ordinary outcome for an empty or punctuation-only response, not an
 * error — the caller leaves the conversation on its default title and says
 * nothing, because a person who did not ask for a title should not be shown a
 * failure to produce one.
 */
export function normalizeTitle(raw: string): string | null {
  // Collapse first: a title arriving as "Fixing\n  the test" is one line to a
  // reader and would otherwise be stored with the newline intact, which the
  // sidebar renders as a space and every export renders as a line break.
  let title = raw.replace(/\s+/g, ' ').trim()

  // Quotes and trailing punctuation interleave — `"Fixing the test".` needs the
  // punctuation gone before the quotes are reachable — so run both to a fixed
  // point rather than once each in a guessed order.
  let previous = ''
  while (title !== previous && title.length > 0) {
    previous = title
    title = stripWrappingQuotes(title)
    title = title.replace(TRAILING_PUNCTUATION, '').trimEnd()
  }

  if (title.length === 0) return null
  if (title.length <= MAX_TITLE_LENGTH) return title

  return truncateOnWordBoundary(title)
}

/**
 * Repeatedly, because a model that wraps a title in quotes will occasionally do
 * it twice — and the second layer is the one that ends up on screen.
 */
function stripWrappingQuotes(value: string): string {
  let result = value

  while (
    result.length >= 2 &&
    OPENING_QUOTES.includes(result.charAt(0)) &&
    CLOSING_QUOTES.includes(result.charAt(result.length - 1))
  ) {
    result = result.slice(1, -1).trim()
  }

  return result
}

/**
 * Cuts to MAX_TITLE_LENGTH, preferring a word boundary.
 *
 * The sidebar already truncates visually with an ellipsis, so this is about what
 * gets *stored* — the value feature 34 exports and feature 26 searches. A cut
 * mid-word is what shows up there.
 *
 * The half-budget floor is what stops the boundary from making things worse: for
 * `a supercalifragilisticexpialidocious…`, the last space sits at index 1 and
 * honouring it would store the single letter `a`.
 */
function truncateOnWordBoundary(title: string): string {
  const clipped = title.slice(0, MAX_TITLE_LENGTH)
  const lastSpace = clipped.lastIndexOf(' ')

  const cut = lastSpace >= MAX_TITLE_LENGTH / 2 ? clipped.slice(0, lastSpace) : clipped

  // The cut can land straight after a comma, so tidy the same edge twice.
  return cut.replace(TRAILING_PUNCTUATION, '').trimEnd()
}
