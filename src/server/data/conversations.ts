import 'server-only'

import { DEFAULT_CONVERSATION_TITLE } from '@/lib/constants'

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
 * Archived rows are excluded outright rather than behind a flag. Feature 22 is
 * where "show archived" is specified, and it can add the parameter then.
 */
export async function listConversations(): Promise<ConversationSummary[]> {
  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase
    .from('conversations')
    .select('id, title, pinned_at, updated_at')
    .is('archived_at', null)
    .order('pinned_at', { ascending: false, nullsFirst: false })
    .order('updated_at', { ascending: false })

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
): Promise<string> {
  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase
    .from('conversations')
    .insert({
      user_id: userId,
      provider: model.provider,
      model_id: model.modelId,
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
