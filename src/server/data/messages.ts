import 'server-only'

import { createServerSupabaseClient } from '@/server/supabase'

import type { Message } from '@/types/domain'

type AppendMessageInput = {
  conversationId: string
  /**
   * Required, and not derivable from the row's conversation. `messages.user_id`
   * is denormalised so the RLS policy needs no join, which also means the insert
   * policy checks this column against `auth.uid()` directly — omit it and the
   * write is rejected rather than silently attributed.
   */
  userId: string
  role: Message['role']
  content: string
  provider?: Message['provider']
  modelId?: string | null
  usedSharedKey?: boolean
  status?: Message['status']
}

/**
 * Appends one message to a conversation and returns its id.
 *
 * The id is returned rather than the row because feature 08 holds it for the
 * life of a stream: the assistant row is created up front in `streaming` status
 * and completion or failure is then a targeted update by primary key. "Update
 * the most recent message" would, at failure time, target the user's prompt.
 */
export async function appendMessage(input: AppendMessageInput): Promise<string> {
  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase
    .from('messages')
    .insert({
      conversation_id: input.conversationId,
      user_id: input.userId,
      role: input.role,
      content: input.content,
      provider: input.provider ?? null,
      model_id: input.modelId ?? null,
      used_shared_key: input.usedSharedKey ?? false,
      status: input.status ?? 'complete',
    })
    .select('id')
    .single()

  if (error) {
    console.error('[data/messages] appendMessage failed', error)
    throw new Error('Failed to save message')
  }

  return data.id
}

/**
 * Marks a streaming assistant message as finished.
 *
 * Targeted by primary key, never "the most recent message" — at the moment a
 * stream ends the newest row may not be the one that was streaming.
 *
 * Token counts are whatever the provider reported and may be undefined; they
 * are stored as null rather than guessed. Feature 17's circuit breaker is fed
 * by measured usage only, and an estimate that enters that ledger trips the
 * breaker for everyone on invented numbers.
 */
export async function completeMessage(
  id: string,
  result: { content: string; inputTokens?: number; outputTokens?: number },
): Promise<void> {
  const supabase = await createServerSupabaseClient()

  const { error } = await supabase
    .from('messages')
    .update({
      content: result.content,
      input_tokens: result.inputTokens ?? null,
      output_tokens: result.outputTokens ?? null,
      status: 'complete',
    })
    .eq('id', id)

  if (error) {
    console.error('[data/messages] completeMessage failed', error)
    throw new Error('Failed to save the response')
  }
}

/**
 * Marks a streaming assistant message as failed, keeping whatever arrived.
 *
 * The row is updated, never deleted. A response that broke halfway is still
 * something the person watched appear, and a thread where it silently vanishes
 * is harder to make sense of than one that says what happened.
 */
export async function failMessage(
  id: string,
  result: { content: string; errorMessage: string },
): Promise<void> {
  const supabase = await createServerSupabaseClient()

  const { error } = await supabase
    .from('messages')
    .update({
      content: result.content,
      status: 'error',
      error_message: result.errorMessage,
    })
    .eq('id', id)

  if (error) {
    console.error('[data/messages] failMessage failed', error)
    throw new Error('Failed to record the error')
  }
}

/**
 * One message, or null when it does not exist or is not the caller's.
 *
 * The two cases are deliberately indistinguishable — RLS filters the row out
 * before this sees it, exactly as `getConversation()` relies on. Callers turn
 * null into a 404, which is the right answer to both.
 */
export async function getMessage(id: string): Promise<Message | null> {
  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    console.error('[data/messages] getMessage failed', error)
    throw new Error('Failed to load the message')
  }

  return data
}

/**
 * Removes one message, returning false when there was nothing to remove.
 *
 * Feature 20's half of the regenerate: the assistant answer being replaced is
 * deleted before its replacement is written, so the thread never briefly holds
 * two answers to one prompt.
 *
 * A boolean rather than void, for the reason `deleteConversation()` gives. RLS
 * filters someone else's row out before the delete sees it, and a delete that
 * matched nothing is reported by PostgREST exactly like one that matched — so
 * without the `.select()` a write that silently did nothing is indistinguishable
 * from a write that worked. The caller decides what to do about false; here it
 * means the row stopped existing between the check and this call.
 *
 * No truncation and no ordering rule, unlike `editMessageAndTruncate()` below.
 * The route has already established that this row is the *last* message in its
 * conversation, so "everything after it" is empty by construction and the
 * `(created_at, id)` comparison has nothing to decide.
 */
export async function deleteMessage(id: string): Promise<boolean> {
  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase
    .from('messages')
    .delete()
    .eq('id', id)
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('[data/messages] deleteMessage failed', error)
    throw new Error('Failed to delete the message')
  }

  return data !== null
}

/**
 * Replaces a user message's content and deletes everything after it.
 *
 * Returns how many messages were removed, or **null** when the message does not
 * exist, is not the caller's, or is not a user message. Those three are one
 * answer on purpose: RLS filters someone else's row out before the update sees
 * it, so the function genuinely cannot tell them apart — and confirming that an
 * id exists but is not yours is itself a disclosure.
 *
 * A database function rather than two calls from here, because PostgREST cannot
 * span a transaction (F07). Update-then-delete as separate round trips can fail
 * in the middle and leave an edited prompt still followed by the answer to the
 * question it used to be — a thread that misrepresents itself, which is worse
 * than either half failing cleanly.
 *
 * The generated type says `Returns: number` because Supabase's generator does
 * not express a nullable function return. The null is real; it is checked here.
 */
export async function editMessageAndTruncate(
  messageId: string,
  content: string,
): Promise<number | null> {
  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase.rpc('edit_message_and_truncate', {
    p_message_id: messageId,
    p_content: content,
  })

  if (error) {
    console.error('[data/messages] editMessageAndTruncate failed', error)
    throw new Error('Failed to edit the message')
  }

  return data ?? null
}

/**
 * Every message in a conversation, oldest first.
 *
 * Ordered by `(created_at, id)`. The leading column matches `messages_thread_idx`
 * and is what actually orders a thread; `id` is a tiebreaker that exists to make
 * the order **total**. Two rows sharing a `created_at` is vanishingly unlikely —
 * the user row and the assistant row of one exchange are separate PostgREST
 * calls, so separate transactions, so different `now()` — but nothing enforces
 * it, and "after this message" has to mean something exact for
 * `editMessageAndTruncate()` to delete the right rows. Its predicate is the same
 * `(created_at, id)` comparison; the two must stay in step.
 *
 * RLS restricts the scan to the caller's rows, so a conversation belonging to
 * someone else returns an empty list rather than its contents.
 */
export async function listByConversation(conversationId: string): Promise<Message[]> {
  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })

  if (error) {
    console.error('[data/messages] listByConversation failed', error)
    throw new Error('Failed to load messages')
  }

  return data
}
