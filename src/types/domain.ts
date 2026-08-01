/**
 * Hand-written application types.
 *
 * Row shapes come from src/types/database.ts, which is generated — never
 * hand-edited, and never duplicated here as a fresh interface that can drift
 * from the schema. This file aliases those rows and adds the view models the
 * application needs on top of them.
 */

import type { Enums, Tables } from '@/types/database'

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
 * The columns the sidebar actually renders.
 *
 * Deliberately narrower than the row. No CDN sits in front of the origin, so
 * every unused column is payload served from one region by the same process
 * that is streaming responses — and `system_prompt` in particular can be 10,000
 * characters that the sidebar has no use for.
 */
export type ConversationSummary = Pick<
  Conversation,
  'id' | 'title' | 'pinned_at' | 'updated_at'
>

/** A recency bucket in the sidebar. Empty buckets are never constructed. */
export type ConversationGroup = {
  label: ConversationGroupLabel
  conversations: readonly ConversationSummary[]
}

export type ConversationGroupLabel = 'Pinned' | 'Today' | 'Previous 7 days' | 'Older'

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
