import { NextResponse } from 'next/server'

import { z } from 'zod'

import { updatePromptSchema } from '@/lib/schemas'

import { getUser } from '@/server/auth'
import { deletePrompt, updatePrompt } from '@/server/data/prompts'

export const runtime = 'nodejs'

type RouteContext = {
  /** A Promise in Next 16 — the synchronous fallback 15 allowed is gone. */
  params: Promise<{ id: string }>
}

/**
 * Rewrites a prompt. (F24)
 *
 * A single strict object rather than the union of branches
 * `PATCH /api/conversations/[id]` carries. That union exists because five
 * separate intents converge on one row and a body carrying two of them must not
 * be answered as one; a prompt has a single intent, and the dialog submits its
 * title, body and tags together every time. Partial branches would be a second
 * way to say "save this prompt" that nothing sends.
 *
 * 404 rather than 403 when the row is not the caller's, for the reason every
 * write in this codebase gives: RLS makes it invisible rather than forbidden, so
 * the handler genuinely cannot tell "someone else's" from "does not exist" — and
 * saying which would confirm the id belongs to somebody.
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

  const parsedBody = updatePromptSchema.safeParse(await request.json())
  if (!parsedBody.success) {
    console.error('[api/prompts] invalid update', parsedBody.error)
    return NextResponse.json(
      { error: 'Invalid request', code: 'invalid_input' },
      { status: 400 },
    )
  }

  try {
    const prompt = await updatePrompt(parsedId.data, parsedBody.data)

    if (!prompt) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    return NextResponse.json(prompt)
  } catch (error) {
    console.error('[api/prompts] update failed', error)
    return NextResponse.json(
      { error: 'Could not save the prompt', code: 'internal_error' },
      { status: 500 },
    )
  }
}

/** Deletes a prompt. Nothing hangs off one, so nothing cascades. */
export async function DELETE(_request: Request, { params }: RouteContext) {
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

  try {
    const deleted = await deletePrompt(parsedId.data)

    if (!deleted) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    // No body. There is nothing left to describe.
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    console.error('[api/prompts] delete failed', error)
    return NextResponse.json(
      { error: 'Could not delete the prompt', code: 'internal_error' },
      { status: 500 },
    )
  }
}
