import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'

import { chatRequestSchema } from '@/lib/schemas'
import { textOf } from '@/lib/utils'

import { getUser } from '@/server/auth'
import {
  createConversation,
  deleteConversation,
  getConversation,
  touchConversation,
} from '@/server/data/conversations'
import { appendMessage } from '@/server/data/messages'

/**
 * Documents intent. On Render every route is Node already, so nothing can
 * silently switch this to Edge and break `node:crypto` in the vault once
 * feature 12 puts it behind this path.
 */
export const runtime = 'nodejs'

/**
 * Sends a message.
 *
 * At this feature the request stops at persistence — no provider is contacted
 * and nothing streams. Feature 08 adds that, and the shape here is built to be
 * extended rather than replaced: see the marker below.
 *
 * Conversation creation lives here rather than in a separate endpoint for one
 * reason. Once feature 16 can refuse a request on quota, the refusal must leave
 * no trace — no dangling prompt, and no empty "New chat" in the sidebar either.
 * That is only true while the same handler owns both the refusal and the
 * creation.
 */
export async function POST(request: Request) {
  // 1. Authenticate. Always first, always before parsing.
  const user = await getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 2. Validate. The zod detail is logged, never returned — it echoes the
  //    submitted values back, which on /api/keys would mean an API key.
  const parsed = chatRequestSchema.safeParse(await request.json())
  if (!parsed.success) {
    console.error('[api/chat] invalid request', parsed.error)
    return NextResponse.json(
      { error: 'Invalid request', code: 'invalid_input' },
      { status: 400 },
    )
  }

  const { conversationId, message, provider, modelId } = parsed.data

  const text = textOf(message)
  if (!text.trim()) {
    return NextResponse.json(
      { error: 'Invalid request', code: 'invalid_input' },
      { status: 400 },
    )
  }

  // An existing conversation must be the caller's. RLS is what makes this
  // return null for someone else's row, so the 404 is a database guarantee
  // rather than a filter this handler remembered to write.
  if (conversationId) {
    const conversation = await getConversation(conversationId)
    if (!conversation) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
  }

  // ── FEATURE 08 INSERTS resolveModel() AND THE QUOTA RESERVATION HERE ──
  // Above every write, without exception. Nothing may be persisted until the
  // request is certain to reach a provider, so that a 400, 429 or 503 leaves
  // no half-made conversation and no prompt that never gets an answer.

  let createdConversationId: string | null = null

  try {
    let targetId = conversationId

    if (!targetId) {
      targetId = await createConversation(user.id, { provider, modelId })
      createdConversationId = targetId
    }

    await appendMessage({
      conversationId: targetId,
      userId: user.id,
      role: 'user',
      content: text,
    })

    // Sorts the conversation to the top of the sidebar. No trigger maintains
    // this column, so it is this call or nothing.
    await touchConversation(targetId)

    revalidatePath('/chat')

    return NextResponse.json({ conversationId: targetId }, { status: 201 })
  } catch (error) {
    console.error('[api/chat] send failed', error)

    // PostgREST cannot span a transaction, so a conversation created a moment
    // ago can outlive the message that justified it. Undo it rather than leave
    // an empty "New chat" in the sidebar. Best-effort: if this fails too, the
    // original error is still what the caller hears about.
    if (createdConversationId) {
      try {
        await deleteConversation(createdConversationId)
      } catch (cleanupError) {
        console.error('[api/chat] could not undo the new conversation', cleanupError)
      }
    }

    return NextResponse.json(
      { error: 'Could not send message', code: 'internal_error' },
      { status: 500 },
    )
  }
}
