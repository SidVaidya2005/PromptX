import { NextResponse } from 'next/server'

import { z } from 'zod'

import { findModel } from '@/lib/models'
import { updateConversationModelSchema } from '@/lib/schemas'

import { getUser } from '@/server/auth'
import { deleteConversation, updateConversationModel } from '@/server/data/conversations'

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
 * it gets the resource route it belongs in — alongside the `PATCH` below, which
 * features 21 and 22 extend for rename, pin, and archive.
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

/**
 * Points a conversation at a different model for its next message.
 *
 * The catalog is checked here as well as in `resolveModel()`, and the duplication
 * is the point: without it a conversation can be left holding a model id that
 * every subsequent send refuses, which reads as a thread that has stopped
 * working rather than as a choice that was never valid. Refusing at the moment
 * of the change keeps the bad state from being written at all — the same
 * ordering `/api/chat` uses for its own refusals.
 *
 * Nothing above this conversation's newest message moves. Each message already
 * records the model that produced it, so a mid-thread change stays visible in
 * the thread rather than rewriting its history.
 */
export async function PATCH(request: Request, { params }: RouteContext) {
  const user = await getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  const parsedId = z.uuid().safeParse(id)
  if (!parsedId.success) {
    return NextResponse.json(
      { error: 'Invalid request', code: 'invalid_input' },
      { status: 400 },
    )
  }

  const parsedBody = updateConversationModelSchema.safeParse(await request.json())
  if (!parsedBody.success) {
    console.error('[api/conversations] invalid model change', parsedBody.error)
    return NextResponse.json(
      { error: 'Invalid request', code: 'invalid_input' },
      { status: 400 },
    )
  }

  const { provider, modelId } = parsedBody.data

  if (!findModel(provider, modelId)) {
    return NextResponse.json(
      { error: 'That model is not available', code: 'unknown_model' },
      { status: 400 },
    )
  }

  try {
    const updated = await updateConversationModel(parsedId.data, { provider, modelId })

    if (!updated) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    return NextResponse.json({ provider, modelId })
  } catch (error) {
    console.error('[api/conversations] model change failed', error)
    return NextResponse.json(
      { error: 'Could not change the model', code: 'internal_error' },
      { status: 500 },
    )
  }
}
