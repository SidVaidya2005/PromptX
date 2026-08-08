import 'server-only'

import { createAnonSupabaseClient } from '@/server/supabase'

import type { Message } from '@/types/domain'

/**
 * A shared conversation, exactly as an anonymous reader may see it. (F33)
 *
 * Narrower than the row on purpose, and this is the payload rule doing security
 * work rather than saving bytes. `conversations` carries `user_id`, and
 * `messages` carries `user_id`, token counts and `used_shared_key` — none of
 * which a public reader has any business receiving. Selecting columns by name
 * means adding a column to either table cannot silently start publishing it.
 */
export type SharedConversation = {
  title: string
  messages: readonly SharedMessage[]
}

/**
 * One message on the public page.
 *
 * `provider` and `modelId` are deliberately kept: which model wrote an answer is
 * the interesting part of a shared conversation, and it says nothing about who
 * owns it.
 */
export type SharedMessage = {
  id: string
  role: Message['role']
  content: string
  /** Null on user messages, and on assistant rows written before F15. */
  modelId: string | null
  /** Metadata only — mime type and position. Never a readable object. (F33) */
  attachments: readonly SharedAttachment[]
}

export type SharedAttachment = {
  id: string
  mimeType: string
  position: number
}

/**
 * Reads a shared conversation by slug, or null when there is nothing to show.
 *
 * **Everything here goes through the anonymous client**, which is the whole
 * security model of this page: no session, so PostgREST resolves the role to
 * `anon`, so only F03's three share policies apply. The invariant is explicit
 * that this must never reach for a service-role client to work around them — if
 * a row does not come back, the correct response is a 404, not a stronger key.
 *
 * Null covers "no such slug" and "the slug was revoked" identically, because
 * after a revoke they are the same thing: the anon policy asks whether
 * `share_slug is not null`, and a revoked conversation answers no. There is no
 * cache to clear and no second flag to unset, which is why revocation is
 * immediate rather than eventually.
 *
 * Three round trips rather than one nested select. PostgREST can embed related
 * rows, but the embed would be filtered by the same policies anyway and the
 * shape it returns for a two-level join is markedly harder to read than three
 * plain selects — and this page is not on any hot path.
 */
export async function getSharedConversation(
  slug: string,
): Promise<SharedConversation | null> {
  const supabase = createAnonSupabaseClient()

  const { data: conversation, error } = await supabase
    .from('conversations')
    .select('id, title')
    .eq('share_slug', slug)
    .maybeSingle()

  if (error) {
    console.error('[data/shared] getSharedConversation failed', error)
    throw new Error('Failed to load the shared conversation')
  }

  if (!conversation) return null

  const { data: messages, error: messagesError } = await supabase
    .from('messages')
    .select('id, role, content, model_id, status')
    .eq('conversation_id', conversation.id)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })

  if (messagesError) {
    console.error('[data/shared] shared messages failed', messagesError)
    throw new Error('Failed to load the shared conversation')
  }

  const visible = (messages ?? []).filter(
    // A row still marked `streaming` belongs to a generation that died — the
    // sweep retires those after five minutes, and until it does the row holds
    // whatever partial text arrived. Showing it on a public page would publish a
    // half-sentence the owner never saw finish.
    (message) => message.status !== 'streaming',
  )

  const { data: attachments, error: attachmentsError } = await supabase
    .from('attachments')
    .select('id, message_id, mime_type, position')
    .in(
      'message_id',
      visible.map((message) => message.id),
    )
    .order('position', { ascending: true })

  if (attachmentsError) {
    console.error('[data/shared] shared attachments failed', attachmentsError)
    throw new Error('Failed to load the shared conversation')
  }

  return {
    title: conversation.title,
    messages: visible.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      modelId: message.model_id,
      attachments: (attachments ?? [])
        .filter((attachment) => attachment.message_id === message.id)
        .map((attachment) => ({
          id: attachment.id,
          mimeType: attachment.mime_type,
          position: attachment.position,
        })),
    })),
  }
}
