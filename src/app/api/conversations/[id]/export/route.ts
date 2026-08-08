import { NextResponse } from 'next/server'

import { z } from 'zod'

import {
  contentDisposition,
  exportFilename,
  toJson,
  toMarkdown,
} from '@/lib/export'
import { exportFormatSchema } from '@/lib/schemas'

import { getUser } from '@/server/auth'
import { listAttachmentsByMessageIds } from '@/server/data/attachments'
import { getConversation } from '@/server/data/conversations'
import { listByConversation } from '@/server/data/messages'

export const runtime = 'nodejs'

type RouteContext = {
  /** A Promise in Next 16 — the synchronous fallback 15 allowed is gone. */
  params: Promise<{ id: string }>
}

/**
 * A conversation as a file. (F34)
 *
 * **`GET`, because a download is a navigation.** The menu item is a plain
 * anchor carrying `download`, so this needs no client JavaScript, no
 * `URL.createObjectURL` and nothing to revoke afterwards. The URL is guessable
 * and useless without the session; RLS makes another user's id a 404 rather than
 * a 403, the distinction every conversation route here makes.
 *
 * **Returned, not streamed**, and §34 was corrected rather than worked around.
 * It asked for a streamed download, and that cannot be honest while
 * `listByConversation` does `select('*')`: the whole thread is in memory before
 * this handler can write a byte, so wrapping it in a `ReadableStream` would
 * satisfy the word and give none of the benefit — the "mechanism that looks like
 * it is working" this project keeps writing down. Real streaming needs a
 * paginated read, and that is recorded as a follow-up rather than smuggled in
 * here.
 *
 * Nothing is written. An export is a point-in-time read, so re-exporting a
 * conversation that has moved on simply produces a different file.
 */
export async function GET(request: Request, { params }: RouteContext) {
  const user = await getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  const parsedId = z.uuid().safeParse(id)
  const parsedFormat = exportFormatSchema.safeParse(
    new URL(request.url).searchParams.get('format'),
  )

  if (!parsedId.success || !parsedFormat.success) {
    return NextResponse.json(
      { error: 'Invalid request', code: 'invalid_input' },
      { status: 400 },
    )
  }

  const format = parsedFormat.data

  try {
    // RLS is what makes this null for somebody else's row, so the 404 below is a
    // database guarantee rather than a filter this handler remembered to write.
    const conversation = await getConversation(parsedId.data)
    if (!conversation) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const messages = await listByConversation(parsedId.data)

    // After the thread, because it needs the message ids. Metadata only — this
    // function signs nothing, which is what keeps an exported file free of
    // bearer tokens for private objects.
    const attachments = await listAttachmentsByMessageIds(
      messages.map((message) => message.id),
    )

    const input = { conversation, messages, attachments }

    const body =
      format === 'markdown'
        ? toMarkdown(input)
        : `${JSON.stringify(toJson(input), null, 2)}\n`

    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type':
          format === 'markdown'
            ? 'text/markdown; charset=utf-8'
            : 'application/json; charset=utf-8',
        // The filename is derived from a user-controlled title, so it is
        // sanitised before it reaches a header — see `exportFilename`, where a
        // CRLF in a title is the thing being defended against.
        'Content-Disposition': contentDisposition(
          exportFilename(conversation.title, format),
        ),
      },
    })
  } catch (error) {
    console.error('[api/conversations/export] export failed', error)
    return NextResponse.json(
      { error: 'Could not export this conversation', code: 'internal_error' },
      { status: 500 },
    )
  }
}
