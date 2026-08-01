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
 * Every message in a conversation, oldest first.
 *
 * Ordered by `created_at` to match `messages_thread_idx`. RLS restricts the scan
 * to the caller's rows, so a conversation belonging to someone else returns an
 * empty list rather than its contents.
 */
export async function listByConversation(conversationId: string): Promise<Message[]> {
  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('[data/messages] listByConversation failed', error)
    throw new Error('Failed to load messages')
  }

  return data
}
