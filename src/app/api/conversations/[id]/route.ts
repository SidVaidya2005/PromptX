import { NextResponse } from 'next/server'

import { z } from 'zod'

import { findModel } from '@/lib/models'
import { updateConversationSchema } from '@/lib/schemas'

import { getUser } from '@/server/auth'
import {
  deleteConversation,
  renameConversation,
  setConversationArchived,
  setConversationPinned,
  updateConversationModel,
} from '@/server/data/conversations'

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
 * Changes one thing about a conversation: its model, its title, or its pin.
 *
 * One endpoint rather than three, because all three are the same statement
 * against the same row and differ only in which column moves. Which one is meant
 * is decided by the shape of the body — `updateConversationSchema` is a union of
 * strict branches, so a body carrying two intents matches none of them and is
 * refused rather than silently answered as one.
 *
 * Each branch below narrows with `in`, never an assertion: `code-standards.md`
 * permits no `!` on a value derived from a request body.
 *
 * **The model branch checks the catalog and the others check nothing.** The
 * duplication with `resolveModel()` is the point: without it a conversation can
 * be left holding a model id that every subsequent send refuses, which reads as
 * a thread that has stopped working rather than as a choice that was never
 * valid. Refusing at the moment of the change keeps the bad state from being
 * written at all — the same ordering `/api/chat` uses for its own refusals. A
 * title and a pin have no catalog to be absent from; their bounds are the
 * schema's whole answer.
 *
 * Nothing in the thread moves for any of the three. Each message already records
 * the model that produced it, so a mid-thread change stays visible in the thread
 * rather than rewriting its history — and neither rename nor pin writes
 * `updated_at`, so the sidebar keeps ordering on activity.
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

  const parsedBody = updateConversationSchema.safeParse(await request.json())
  if (!parsedBody.success) {
    console.error('[api/conversations] invalid update', parsedBody.error)
    return NextResponse.json(
      { error: 'Invalid request', code: 'invalid_input' },
      { status: 400 },
    )
  }

  const body = parsedBody.data

  if ('title' in body) {
    // Already trimmed and bounded by the schema, which is also why the value
    // echoed back is the parsed one rather than what arrived on the wire.
    const { title } = body

    try {
      const renamed = await renameConversation(parsedId.data, title)

      if (!renamed) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
      }

      return NextResponse.json({ title })
    } catch (error) {
      console.error('[api/conversations] rename failed', error)
      return NextResponse.json(
        { error: 'Could not rename the conversation', code: 'internal_error' },
        { status: 500 },
      )
    }
  }

  if ('pinned' in body) {
    const { pinned } = body

    try {
      const changed = await setConversationPinned(parsedId.data, pinned)

      if (!changed) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
      }

      return NextResponse.json({ pinned })
    } catch (error) {
      console.error('[api/conversations] pin change failed', error)
      return NextResponse.json(
        { error: 'Could not change the pin', code: 'internal_error' },
        { status: 500 },
      )
    }
  }

  if ('archived' in body) {
    const { archived } = body

    try {
      const changed = await setConversationArchived(parsedId.data, archived)

      if (!changed) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
      }

      return NextResponse.json({ archived })
    } catch (error) {
      console.error('[api/conversations] archive change failed', error)
      return NextResponse.json(
        { error: 'Could not archive the conversation', code: 'internal_error' },
        { status: 500 },
      )
    }
  }

  const { provider, modelId } = body

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
