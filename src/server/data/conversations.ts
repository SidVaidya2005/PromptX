import 'server-only'

import { createServerSupabaseClient } from '@/server/supabase'

import type { ConversationSummary } from '@/types/domain'

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
