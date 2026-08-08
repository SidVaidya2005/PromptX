import 'server-only'

import { DEFAULT_CONVERSATION_TITLE, SHARE_SLUG_MAX_RETRIES } from '@/lib/constants'
import { generateShareSlug } from '@/lib/share'

import { createServerSupabaseClient } from '@/server/supabase'

import type { Conversation, ConversationSummary, Provider } from '@/types/domain'

/**
 * The caller's conversations for the sidebar, newest activity first.
 *
 * There is no `.eq('user_id', …)` here on purpose. The owner-read RLS policy is
 * `(select auth.uid()) = user_id`, so the cookie-bound client can only ever see
 * the caller's rows — a filter would be harmless but would also make it look as
 * though the filter is what provides the isolation. It is not; the policy is.
 *
 * The ordering matches `conversations_sidebar_idx` column for column, so this
 * reads straight off the index. `nullsFirst: false` is what makes the unpinned
 * rows sort after the pinned ones rather than before them.
 *
 * `includeArchived` defaults to false, so hiding archived rows is what happens
 * when nobody says otherwise — the flag can only ever widen the result, never
 * narrow it. It is a filter and not a second ordering: revealed rows come back
 * interleaved by pin and recency exactly as they were, and `groupConversations`
 * is what files them under Archived. The index carries no partial predicate, so
 * both shapes of this query read off the same one. (F22)
 */
export async function listConversations(
  includeArchived = false,
): Promise<ConversationSummary[]> {
  const supabase = await createServerSupabaseClient()

  const query = supabase
    .from('conversations')
    // `share_slug` rather than a derived boolean, and it is twelve characters
    // against the rule this select follows. The sidebar only needs to know
    // *whether* a row is shared — but the value is the owner's own, the chip is
    // the only place that would compute the boolean, and a column the row
    // already has beats a second name for the same fact. (F33)
    .select('id, title, pinned_at, archived_at, updated_at, share_slug')
    .order('pinned_at', { ascending: false, nullsFirst: false })
    .order('updated_at', { ascending: false })

  const { data, error } = await (includeArchived ? query : query.is('archived_at', null))

  if (error) {
    console.error('[data/conversations] listConversations failed', error)
    throw new Error('Failed to load conversations')
  }

  return data
}

/** One conversation, or null when it does not exist or is not owned by the caller. */
export async function getConversation(id: string): Promise<Conversation | null> {
  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase
    .from('conversations')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    console.error('[data/conversations] getConversation failed', error)
    throw new Error('Failed to load conversation')
  }

  return data
}

/**
 * Creates an empty conversation and returns its id.
 *
 * Called only when a message is actually being sent — never when the composer
 * loads — so abandoning a draft leaves nothing behind. The title is left at the
 * column default of 'New chat'; feature 10 replaces it from the first exchange.
 */
export async function createConversation(
  userId: string,
  model: { provider: Provider; modelId: string },
  systemPrompt: string | null = null,
): Promise<string> {
  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase
    .from('conversations')
    .insert({
      user_id: userId,
      provider: model.provider,
      model_id: model.modelId,
      // The one moment a system prompt can arrive from a request body. On
      // `/chat` there is no row to PATCH yet, so the composer's prompt travels
      // with the first message — and this insert is the only place the chat
      // route is allowed to read it from. (F23)
      system_prompt: systemPrompt,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[data/conversations] createConversation failed', error)
    throw new Error('Failed to create conversation')
  }

  return data.id
}

/**
 * Marks a conversation as just-used.
 *
 * Load-bearing rather than bookkeeping: there is no trigger on
 * `conversations.updated_at`, and the sidebar orders on it. Skip this and every
 * conversation keeps its creation time forever — the list silently stops
 * reflecting activity, with nothing to indicate why.
 */
export async function touchConversation(id: string): Promise<void> {
  const supabase = await createServerSupabaseClient()

  const { error } = await supabase
    .from('conversations')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', id)

  if (error) {
    console.error('[data/conversations] touchConversation failed', error)
    throw new Error('Failed to update conversation')
  }
}

/**
 * Names a conversation, but only while it is still called 'New chat'.
 *
 * The `.eq('title', …)` is a guard, not a filter, and it is why this returns a
 * boolean. Auto-titling runs from a fire-and-forget request after the stream
 * closes, so the row can move underneath it — the user renames the conversation
 * (feature 21), or a duplicated request arrives. Making the condition part of
 * the statement means the database decides, once, rather than a read-then-write
 * in the caller deciding on data that was true a moment ago.
 *
 * Returns true when this call is the one that named it.
 */
export async function setGeneratedTitle(id: string, title: string): Promise<boolean> {
  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase
    .from('conversations')
    .update({ title })
    .eq('id', id)
    .eq('title', DEFAULT_CONVERSATION_TITLE)
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('[data/conversations] setGeneratedTitle failed', error)
    throw new Error('Failed to save the title')
  }

  return data !== null
}

/**
 * Points a conversation at a different model for its next message.
 *
 * Returns whether a row actually changed, for the same reason `deleteConversation`
 * does: RLS makes someone else's conversation invisible rather than forbidden, so
 * an update that matches nothing reports no error and is indistinguishable from
 * success. The route turns false into a 404.
 *
 * Only `provider` and `model_id` move. `updated_at` is deliberately left alone —
 * it orders the sidebar by *activity*, and changing the model is not activity.
 * Touching it here would float a conversation to the top for a click that
 * produced no message, which is exactly the kind of drift `touchConversation`
 * exists to make deliberate.
 *
 * Nothing already in the thread is rewritten. Each message carries the model
 * that produced it, so a conversation whose model changed mid-way stays honest
 * about its own history. (F15)
 */
export async function updateConversationModel(
  id: string,
  model: { provider: Provider; modelId: string },
): Promise<boolean> {
  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase
    .from('conversations')
    .update({ provider: model.provider, model_id: model.modelId })
    .eq('id', id)
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('[data/conversations] updateConversationModel failed', error)
    throw new Error('Failed to change the model')
  }

  return data !== null
}

/**
 * Gives a conversation the name its owner chose. (F21)
 *
 * Unconditional where `setGeneratedTitle` is guarded: a person renaming their
 * own conversation outranks whatever is there, including a title the model
 * generated. The relationship runs the other way — once the title is anything
 * but 'New chat', the generator's `.eq()` declines to write — so a manual rename
 * suppresses auto-titling permanently without a column to record that it
 * happened.
 *
 * Bounds and whitespace are `conversationRenameSchema`'s job at the route. What
 * arrives here is already trimmed and within `MAX_TITLE_LENGTH`.
 *
 * Returns whether a row actually changed, for the reason `updateConversationModel`
 * records: RLS makes someone else's conversation invisible rather than
 * forbidden, so an update that matches nothing reports no error. `updated_at` is
 * left alone — the sidebar orders on activity, and naming something is not
 * activity.
 */
export async function renameConversation(id: string, title: string): Promise<boolean> {
  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase
    .from('conversations')
    .update({ title })
    .eq('id', id)
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('[data/conversations] renameConversation failed', error)
    throw new Error('Failed to rename conversation')
  }

  return data !== null
}

/**
 * Pins a conversation to the top of the sidebar, or lets it back into the
 * recency ordering. (F21)
 *
 * Takes the desired state rather than toggling. A toggle would be implementable
 * atomically — `case when pinned_at is null` — so this is not about a race; it
 * is that a delta undoes itself when the same request arrives twice, and a state
 * does not.
 *
 * The timestamp written is the moment of the pin, and nothing reads its value
 * yet: `listConversations()` orders on it but `groupConversations()` only asks
 * whether it is null. Recording it anyway is what leaves "most recently pinned
 * first" available without a migration.
 *
 * `updated_at` stays where it is, and this is the case where that matters most:
 * touching it would reorder the row *inside* the Pinned group for a click that
 * produced no message.
 */
export async function setConversationPinned(
  id: string,
  pinned: boolean,
): Promise<boolean> {
  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase
    .from('conversations')
    .update({ pinned_at: pinned ? new Date().toISOString() : null })
    .eq('id', id)
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('[data/conversations] setConversationPinned failed', error)
    throw new Error('Failed to change the pin')
  }

  return data !== null
}

/**
 * Sets the standing instruction for a conversation, or clears it. (F23)
 *
 * Null is a real value here rather than "no change" — it is how a prompt is
 * removed, and it is what `getConversation()` reads back as "use the provider's
 * default". The route sends `system: undefined` for null, so an empty string
 * must never reach this function: that would be a *value* handed to the model
 * rather than the absence of one. `conversationSystemPromptSchema` collapses
 * empty to null before it gets here, which is why this takes `string | null`
 * and not `string | undefined`.
 *
 * Bounded at `MAX_SYSTEM_PROMPT_LENGTH` by that same schema. Nothing is checked
 * again here, for the reason `renameConversation` records.
 *
 * `updated_at` is left alone — the fourth write in a row to say so. Changing an
 * instruction is not activity, and a conversation should not climb the sidebar
 * because its owner adjusted how it will answer next time.
 *
 * Returns whether a row changed, the RLS no-op distinction every write in this
 * file makes.
 */
export async function updateSystemPrompt(
  id: string,
  systemPrompt: string | null,
): Promise<boolean> {
  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase
    .from('conversations')
    .update({ system_prompt: systemPrompt })
    .eq('id', id)
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('[data/conversations] updateSystemPrompt failed', error)
    throw new Error('Failed to save the system prompt')
  }

  return data !== null
}

/**
 * Puts a conversation away, or takes it back out. (F22)
 *
 * The narrowest write in the file: one nullable timestamp, and nothing else
 * about the conversation changes. **`pinned_at` in particular is left alone**,
 * which is what lets unarchiving restore a row to the Pinned group rather than
 * dropping it into recency — `groupConversations` resolves the overlap by
 * checking Archived first, so a row that is both has a group without either
 * column having to yield.
 *
 * `updated_at` is untouched for the third time in two features, and here the
 * reason is sharper than usual: archiving is the user saying they are *done*
 * with a conversation, so floating it to the top of the ordering would be the
 * precise opposite of what they asked for. It matters even while the row is
 * hidden, because unarchiving has to put it back where it was.
 *
 * Desired state rather than a toggle, and returns whether a row changed, both
 * for the reasons `setConversationPinned` records.
 */
export async function setConversationArchived(
  id: string,
  archived: boolean,
): Promise<boolean> {
  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase
    .from('conversations')
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq('id', id)
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('[data/conversations] setConversationArchived failed', error)
    throw new Error('Failed to archive conversation')
  }

  return data !== null
}

/**
 * Mints a public link for a conversation, or returns the one it already has. (F33)
 *
 * **Already-shared returns the existing slug and writes nothing.** `{shared:
 * true}` is desired state, like the pin and the archive above it, so a second
 * click must not break a URL the owner has already pasted somewhere. Only
 * revoke-then-share mints a new one, which is what makes "a revoked URL is never
 * reinstated" true: the old slug is gone from the row, so nothing can bring it
 * back.
 *
 * `shared_at` moves with the slug because they are one fact. The slug is the
 * state — the column comment has said so since F02 — and the timestamp is when
 * it started.
 *
 * **The retry is bounded, and it is not a formality.** `share_slug` is `unique`,
 * so a collision is a real `23505` rather than a hypothetical one; at ~71 bits it
 * will not happen, and an unbounded loop against a bug that made the generator
 * constant would spin forever instead of failing. Giving up after
 * `SHARE_SLUG_MAX_RETRIES` turns that into an error somebody can see.
 *
 * Returns null when no row matched — RLS makes someone else's conversation
 * invisible rather than forbidden, the distinction every write in this file
 * makes. `updated_at` is left alone: sharing is not activity.
 */
export async function shareConversation(id: string): Promise<string | null> {
  const supabase = await createServerSupabaseClient()

  const existing = await getConversation(id)
  if (!existing) return null
  if (existing.share_slug) return existing.share_slug

  for (let attempt = 0; attempt < SHARE_SLUG_MAX_RETRIES; attempt += 1) {
    const slug = generateShareSlug()

    const { data, error } = await supabase
      .from('conversations')
      .update({ share_slug: slug, shared_at: new Date().toISOString() })
      .eq('id', id)
      .select('share_slug')
      .maybeSingle()

    // 23505 is a unique violation, and the ONLY error worth another attempt.
    // Anything else is a fault rather than a collision, and retrying it would
    // turn one failure into three.
    if (error?.code === '23505') continue

    if (error) {
      console.error('[data/conversations] shareConversation failed', error)
      throw new Error('Failed to share conversation')
    }

    return data?.share_slug ?? null
  }

  // Never a non-random fallback. A predictable slug is a public conversation
  // somebody can find without the link, which is the one outcome worse than
  // failing the request.
  console.error('[data/conversations] shareConversation exhausted slug attempts', { id })
  throw new Error('Failed to share conversation')
}

/**
 * Revokes a public link. (F33)
 *
 * Nulls both columns, and the old URL stops working on the very next request —
 * not because anything is invalidated, but because the anon policy reads
 * `share_slug is not null` and there is now nothing to match. That is the whole
 * argument for the slug being the state rather than a boolean beside it: there
 * is no second flag to forget, and no cache in between.
 */
export async function unshareConversation(id: string): Promise<boolean> {
  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase
    .from('conversations')
    .update({ share_slug: null, shared_at: null })
    .eq('id', id)
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('[data/conversations] unshareConversation failed', error)
    throw new Error('Failed to revoke the share link')
  }

  return data !== null
}

/**
 * Deletes a conversation. Messages and attachments follow by `on delete cascade`.
 *
 * Returns whether a row actually went. The distinction matters because RLS makes
 * someone else's conversation invisible rather than forbidden — the delete
 * simply matches nothing and reports no error, which is indistinguishable from
 * success unless the row count comes back. `.select()` after `.delete()` returns
 * the deleted rows, so this is one round trip rather than a read-then-delete.
 *
 * Note the cascade reaches attachment *rows* but not their storage objects,
 * which SQL cannot touch. Feature 28's reaper sweeps objects whose row is gone.
 */
export async function deleteConversation(id: string): Promise<boolean> {
  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase
    .from('conversations')
    .delete()
    .eq('id', id)
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('[data/conversations] deleteConversation failed', error)
    throw new Error('Failed to delete conversation')
  }

  return data !== null
}
