import { NextResponse } from 'next/server'

import { z } from 'zod'

import { getUser } from '@/server/auth'
import { deleteConversation } from '@/server/data/conversations'

export const runtime = 'nodejs'

type RouteContext = {
  /** A Promise in Next 16 — the synchronous fallback 15 allowed is gone. */
  params: Promise<{ id: string }>
}

/**
 * Deletes a conversation and everything that hangs off it.
 *
 * Conversation *creation* deliberately lives inside `/api/chat` so that a
 * refusal there leaves nothing behind (F07). Deletion has no such constraint, so
 * it gets the resource route it belongs in — which is also where features 21 and
 * 22 will add `PATCH` for rename, pin, and archive.
 *
 * 404 rather than 403 for a conversation the caller does not own. RLS makes it
 * invisible rather than forbidden, so the handler genuinely cannot distinguish
 * "someone else's" from "does not exist" — and saying so would confirm the id
 * belongs to somebody.
 */
export async function DELETE(_request: Request, { params }: RouteContext) {
  const user = await getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  const parsed = z.uuid().safeParse(id)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', code: 'invalid_input' },
      { status: 400 },
    )
  }

  try {
    const deleted = await deleteConversation(parsed.data)

    if (!deleted) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    // No body. There is nothing left to describe.
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    console.error('[api/conversations] delete failed', error)
    return NextResponse.json(
      { error: 'Could not delete conversation', code: 'internal_error' },
      { status: 500 },
    )
  }
}
