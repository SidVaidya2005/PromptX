import 'server-only'

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
 * Deletes a conversation. Messages and attachments follow by `on delete cascade`.
 *
 * Used here only to undo a conversation whose first message failed to save.
 * Feature 11 builds the sidebar action on top of it.
 */
export async function deleteConversation(id: string): Promise<void> {
  const supabase = await createServerSupabaseClient()

  const { error } = await supabase.from('conversations').delete().eq('id', id)

  if (error) {
    console.error('[data/conversations] deleteConversation failed', error)
    throw new Error('Failed to delete conversation')
  }
}
