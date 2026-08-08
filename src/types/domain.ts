/**
 * Hand-written application types.
 *
 * Row shapes come from src/types/database.ts, which is generated — never
 * hand-edited, and never duplicated here as a fresh interface that can drift
 * from the schema. This file aliases those rows and adds the view models the
 * application needs on top of them.
 */

import type { Database, Enums, Tables } from '@/types/database'

/**
 * The Postgres enums, aliased rather than restated. `code-standards.md` forbids
 * redeclaring a union of string literals that duplicates a database enum —
 * these stay correct through a migration, a hand-written union would not.
 */
export type Provider = Enums<'provider'>
export type MessageRole = Enums<'message_role'>
export type MessageStatus = Enums<'message_status'>

export type Profile = Tables<'profiles'>

export type Conversation = Tables<'conversations'>

export type Message = Tables<'messages'>

/**
 * One ranked hit from `search_messages`. (F26)
 *
 * Aliased from the generated function return rather than restated, for the same
 * reason the enums are: a change to the function's `returns table` should be a
 * type error here, not a silent disagreement.
 *
 * `snippet` is **plain text**, with matched terms wrapped in
 * `SEARCH_MATCH_START` / `SEARCH_MATCH_END`. It is never markup — see the
 * constants, and the migration, for why.
 */
export type SearchResult = Database['public']['Functions']['search_messages']['Returns'][number]

/**
 * What a search actually found, or why it could not look. (F26)
 *
 * A union rather than a bare array because "no matches" and "there was nothing
 * here to search for" are different answers and the UI has to say different
 * things. A query of only stopwords — `the and of` — parses to an empty
 * `tsquery`, so it can never match anything; reporting that as "no results"
 * reads as the search being broken rather than as the query being empty.
 */
export type SearchOutcome =
  | { status: 'no_terms' }
  | { status: 'ok'; results: SearchResult[] }

/**
 * One saved prompt in the library. (F24)
 *
 * The whole row, unlike `ConversationSummary`, and the difference is what the
 * page does with it: the grid renders a preview of `body` and filters on `tags`
 * in the browser, so there is no column here the client does not use.
 */
export type Prompt = Tables<'prompts'>

/**
 * The columns the sidebar actually renders.
 *
 * Deliberately narrower than the row. No CDN sits in front of the origin, so
 * every unused column is payload served from one region by the same process
 * that is streaming responses — and `system_prompt` in particular can be 10,000
 * characters that the sidebar has no use for.
 */
export type ConversationSummary = Pick<
  Conversation,
  'id' | 'title' | 'pinned_at' | 'archived_at' | 'updated_at'
>

/** A recency bucket in the sidebar. Empty buckets are never constructed. */
export type ConversationGroup = {
  label: ConversationGroupLabel
  conversations: readonly ConversationSummary[]
}

/**
 * `Pinned` and `Archived` are the two that are not about recency at all, and
 * they sit at opposite ends for that reason — lifted out of the ordering, or put
 * away below it. (F22)
 */
export type ConversationGroupLabel =
  | 'Pinned'
  | 'Today'
  | 'Previous 7 days'
  | 'Older'
  | 'Archived'

/**
 * What the settings page may know about a stored key.
 *
 * Narrower than the row, and the narrowing is the security boundary rather than
 * a payload optimisation. `ciphertext`, `iv`, and `auth_tag` are deliberately
 * absent: RLS is row-level, so an owner *can* read their own ciphertext through
 * PostgREST — what keeps it off the wire is that the application never selects
 * it. `last_four` is the only key material permitted to leave the server.
 */
export type ProviderKeySummary = Pick<
  Tables<'provider_keys'>,
  'provider' | 'last_four' | 'label' | 'created_at'
>

/**
 * What the shell needs to render a person, resolved once on the server.
 *
 * Deliberately not the whole `Profile` row: the components under
 * src/components/ are presentation only, and handing them the raw row invites
 * them to start deriving display logic per call site. `displayName` is already
 * resolved against its fallbacks by the time it gets here.
 */
export type ShellUser = {
  displayName: string
  email: string
  avatarUrl: string | null
}
