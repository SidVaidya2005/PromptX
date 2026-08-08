/**
 * The prompt library's rules, kept pure so they can be tested. (F24)
 *
 * Everything the grid decides — what a card previews, which tags exist, and
 * which prompts survive the search box and the tag filter — lives here rather
 * than inside the components that call it. `vitest.config.ts` matches
 * `tests/**` in a node environment and can see nothing rendered, so a pure
 * helper is the only part of a UI feature that can have automated coverage
 * before F36, the split F05 established and F09, F10 and F18 have each reused.
 */

import {
  MAX_PROMPT_TAG_LENGTH,
  MAX_PROMPT_TITLE_LENGTH,
  PROMPT_BODY_PREVIEW_LENGTH,
} from '@/lib/constants'

import type { Prompt } from '@/types/domain'

/** What the search box and the tag filter currently ask for. */
export type PromptFilter = {
  query: string
  /** Null is "every tag", not "prompts with no tags". */
  tag: string | null
}

/**
 * What a card renders in place of the body.
 *
 * Whitespace collapses before the cut, for the reason `systemPromptPreview()`
 * records: a prompt written as a list opens with a newline as often as not, and
 * slicing the raw string would leave a card looking empty. `line-clamp-3` then
 * decides how much of this is *seen* — this decides how much is in the document
 * at all, which matters because the grid holds every prompt the user owns.
 */
export function promptBodyPreview(body: string): string {
  const flattened = body.replace(/\s+/g, ' ').trim()

  return flattened.length > PROMPT_BODY_PREVIEW_LENGTH
    ? `${flattened.slice(0, PROMPT_BODY_PREVIEW_LENGTH)}…`
    : flattened
}

/**
 * Every tag in the library, once each, alphabetically.
 *
 * Alphabetical rather than by frequency or recency: the filter is a fixed row of
 * chips the user's eye returns to, and an order that reshuffles as prompts are
 * edited would move the target between one visit and the next.
 *
 * The tags are already lowercase — `promptTagsSchema` is what guarantees that,
 * and nothing here re-normalises. If a row predates the schema, it sorts where
 * its own casing puts it, which is visible rather than silently merged.
 */
export function collectTags(prompts: readonly Prompt[]): string[] {
  const tags = new Set<string>()

  for (const prompt of prompts) {
    for (const tag of prompt.tags) tags.add(tag)
  }

  return [...tags].sort((a, b) => a.localeCompare(b))
}

/**
 * The prompts that survive the current search box and tag filter.
 *
 * The query matches the **title only**, which is what `build-plan.md` §24 asks
 * for and is a narrower promise than it looks: matching bodies too would make
 * this a worse version of F26's `search_messages`, which ranks with `ts_rank`
 * over a `tsvector` rather than scanning substrings, and would leave the same
 * word finding a prompt here and not there.
 *
 * Both conditions are ANDed, and an active tag survives a query that matches
 * nothing — so the empty state has to distinguish "no prompts at all" from "none
 * that match", which the page does.
 */
export function filterPrompts(
  prompts: readonly Prompt[],
  { query, tag }: PromptFilter,
): Prompt[] {
  const needle = query.trim().toLowerCase()

  return prompts.filter((prompt) => {
    if (tag !== null && !prompt.tags.includes(tag)) return false
    if (needle === '') return true

    return prompt.title.toLowerCase().includes(needle)
  })
}

/**
 * The prompts matching what someone typed into the composer's picker. (F25)
 *
 * **A different rule from `filterPrompts()` above, on purpose, and the reason is
 * structural rather than a matter of taste.** `/prompts` has a row of tag chips
 * beside its search box, so its query only ever has to match titles — the tags
 * have their own control. The picker is a panel anchored to a toolbar button
 * with no room for that row, so a tag either folds into the query here or
 * becomes unreachable from the composer entirely.
 *
 * That makes these two rules rather than two spellings of one, which is the
 * distinction F15 draws: a rule with one definition and two callers is not the
 * same thing as one rule written twice. Both behaviours are pinned by tests, so
 * the divergence stays deliberate — if they are ever meant to converge, that is
 * a decision someone makes rather than a drift nobody notices.
 *
 * The body is still not matched, for the reason `filterPrompts()` records: a
 * common word appears in most bodies, so the list would stop narrowing exactly
 * when someone is typing to narrow it.
 */
export function searchPrompts(prompts: readonly Prompt[], query: string): Prompt[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return [...prompts]

  return prompts.filter(
    (prompt) =>
      prompt.title.toLowerCase().includes(needle) ||
      prompt.tags.some((tag) => tag.includes(needle)),
  )
}

/**
 * A starting title for a prompt being saved out of the system-prompt dialog. (F24)
 *
 * The **first line**, not the first N characters: a standing instruction is
 * usually written as a headline followed by detail, so the line break is the
 * author's own answer to "what is this prompt about". Falling back to the whole
 * flattened body covers a prompt written as one paragraph.
 *
 * A suggestion and never a decision — F23's shortcut puts this in an input the
 * user can rewrite before saving. It is capped because `createPromptSchema`
 * would refuse anything longer, and a field that opens already invalid is a
 * worse first impression than one that opens truncated.
 */
export function titleFromBody(body: string): string {
  const [firstLine = ''] = body.split('\n')
  const candidate = firstLine.trim() === '' ? body : firstLine

  return candidate.replace(/\s+/g, ' ').trim().slice(0, MAX_PROMPT_TITLE_LENGTH)
}

/** What the composer's draft becomes when a prompt is inserted into it. (F25) */
export type PromptInsertion = {
  text: string
  /** Where the caret goes afterwards: the end of what was just inserted. */
  caret: number
}

/**
 * Puts a prompt's body into a draft at the caret. (F25)
 *
 * Pure, and separated from the textarea for the reason F05 established: vitest
 * runs in a node environment against `tests/`, so this is the only part of the
 * insertion that can be tested at all before F36. What is left in the component
 * is reading `selectionStart`/`selectionEnd` and writing the result back.
 *
 * **A selection is replaced**, which is what every editor does and what makes
 * "insert at the cursor" well defined when the cursor is a range rather than a
 * point.
 *
 * **Newlines are added only where they are needed.** A prompt dropped straight
 * against existing words would run into them — `explain thisReview this diff` —
 * so a separator goes in when the neighbouring character is not already
 * whitespace, on each side independently. Inserting into an empty draft, or on
 * its own blank line, therefore adds nothing at all, which is the common case.
 *
 * The caret lands after the inserted body rather than after any trailing
 * separator, so typing continues where the reader is looking.
 */
export function insertPromptAt(
  draft: string,
  selectionStart: number,
  selectionEnd: number,
  body: string,
): PromptInsertion {
  const before = draft.slice(0, selectionStart)
  const after = draft.slice(selectionEnd)

  const needsLeadingBreak = before !== '' && !/\s$/.test(before)
  const needsTrailingBreak = after !== '' && !/^\s/.test(after)

  const lead = needsLeadingBreak ? '\n' : ''
  const trail = needsTrailingBreak ? '\n' : ''

  return {
    text: `${before}${lead}${body}${trail}${after}`,
    caret: before.length + lead.length + body.length,
  }
}

/**
 * A tag as the chip input commits it, or null when there is nothing to commit.
 *
 * The same lowercase-and-trim `promptTagsSchema` applies, deliberately spelled
 * twice rather than shared — this one runs per keystroke on a value that is not
 * a request body yet, and it has to return null for "not a tag" where the schema
 * drops the element instead. The schema stays authoritative: a chip that slipped
 * through here in some other casing would still be normalised on save.
 *
 * Over-length input is truncated rather than refused. The cap is the schema's to
 * enforce; here it is a text field someone is still typing into, and refusing
 * the keystroke that crosses the boundary reads as a broken input.
 */
export function normalizeTagInput(raw: string): string | null {
  const tag = raw.trim().toLowerCase().slice(0, MAX_PROMPT_TAG_LENGTH)

  return tag === '' ? null : tag
}
