import { NextResponse } from 'next/server'

import { z } from 'zod'

import { getUser } from '@/server/auth'
import { deleteAttachment } from '@/server/data/attachments'

export const runtime = 'nodejs'

type RouteContext = {
  /** A Promise in Next 16 — the synchronous fallback 15 allowed is gone. */
  params: Promise<{ id: string }>
}

/**
 * Withdraws a file from the composer. (F29)
 *
 * Deletes all three storage objects and then the row, in that order and never
 * the other way round — a crash between them leaves a row pointing at a missing
 * file, which the reaper clears, while the reverse strands the file with nothing
 * left naming it.
 *
 * Only unlinked drafts. Once an attachment has been sent it belongs to the
 * thread, and removing it from a message somebody has already read is a
 * different operation that nothing in §28–§30 asks for — so that case is a 404
 * rather than a special path.
 *
 * The client calls this on removal **and** on a failed upload, which is why
 * there is no separate "mark this failed" endpoint: `status = 'failed'` would be
 * a state nothing consults, since the send path already refuses anything that is
 * not `'ready'`.
 */
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
    const removed = await deleteAttachment(parsedId.data)

    // Covers not-owned, already-sent and never-existed alike. RLS makes the
    // first invisible rather than forbidden, so the handler genuinely cannot
    // tell them apart — and saying which would confirm the id belongs to
    // somebody.
    if (!removed) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    return new NextResponse(null, { status: 204 })
  } catch (error) {
    console.error('[api/attachments] delete failed', error)
    return NextResponse.json(
      { error: 'Could not remove the attachment', code: 'internal_error' },
      { status: 500 },
    )
  }
}
