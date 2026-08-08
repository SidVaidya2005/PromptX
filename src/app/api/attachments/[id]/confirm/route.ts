import { NextResponse } from 'next/server'

import { z } from 'zod'

import {
  ALLOWED_ATTACHMENT_MIME_TYPES,
  ATTACHMENT_DERIVATIVE_MIME,
  MAX_ATTACHMENT_BYTES,
} from '@/lib/constants'

import { toRenderedAttachments } from '@/server/attachments'
import { getUser } from '@/server/auth'
import {
  getAttachment,
  markAttachmentReady,
  readObjectFacts,
} from '@/server/data/attachments'

export const runtime = 'nodejs'

type RouteContext = {
  /** A Promise in Next 16 — the synchronous fallback 15 allowed is gone. */
  params: Promise<{ id: string }>
}

/**
 * Confirms that an upload finished, and measures what it actually was. (F28)
 *
 * **The client does not get to say a row is ready.** Every field on the draft
 * was a claim about bytes that had not been sent, and the bytes never came
 * through this process — so this handler asks Storage what is really at each
 * path and writes the answer. A row reaching `'ready'` therefore means the
 * objects exist, not that something asserted they do. F17's ledger takes the
 * same position about tokens, and for the same reason: a number nobody measured
 * is not evidence, it is a rumour with a schema.
 *
 * Without it a client could confirm a row it never uploaded, attach it to a
 * message, spend a shared-key slot, and have the generation fail on a file that
 * was never there — with a thread left holding an attachment that cannot render.
 *
 * Every object is checked on the same terms, derivatives included, which is what
 * §28 asks for. A `_thumb` that came back as a 9 MB PNG is a client that did not
 * do what it said it did, so the attachment is refused rather than quietly
 * repaired: the row stays `'pending'` and the reaper takes it and its objects a
 * day later.
 */
export async function POST(_request: Request, { params }: RouteContext) {
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
    const attachment = await getAttachment(parsedId.data)

    // Null covers not-owned as well as never-existed: RLS filters someone
    // else's row out of the read entirely, so this handler genuinely cannot
    // tell the two apart — and saying which would confirm the id belongs to
    // somebody.
    if (!attachment) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    // Already sent with a message. Confirming again would rewrite the record of
    // a file somebody has already read in a thread.
    if (attachment.message_id !== null) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const derivatives = [attachment.thumb_path, attachment.inline_path].filter(
      (path): path is string => path !== null,
    )

    const original = await readObjectFacts(attachment.storage_path)

    if (!original) {
      return NextResponse.json(
        { error: 'That upload did not finish', code: 'upload_incomplete' },
        { status: 409 },
      )
    }

    if (!isAcceptable(original.mimeType, original.sizeBytes)) {
      return NextResponse.json(
        { error: 'That file cannot be attached', code: 'invalid_upload' },
        { status: 400 },
      )
    }

    for (const path of derivatives) {
      const facts = await readObjectFacts(path)

      if (!facts) {
        return NextResponse.json(
          { error: 'That upload did not finish', code: 'upload_incomplete' },
          { status: 409 },
        )
      }

      // A derivative is not merely on the allowlist, it is webp specifically —
      // it is a size this application asked for, not a file a person chose.
      if (
        facts.mimeType !== ATTACHMENT_DERIVATIVE_MIME ||
        facts.sizeBytes > MAX_ATTACHMENT_BYTES
      ) {
        return NextResponse.json(
          { error: 'That file cannot be attached', code: 'invalid_upload' },
          { status: 400 },
        )
      }
    }

    // The original's measured facts are what the row records. The derivatives
    // have no columns of their own beyond their paths, which is correct: they
    // are renderings of this file, not files in their own right.
    const ready = await markAttachmentReady(parsedId.data, original)

    if (!ready) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    // Signed URLs come back with the row, so the message this attachment is
    // about to be sent with can render immediately. (F29) The alternative is
    // object URLs held in client state, which then have to survive the composer
    // clearing itself and be revoked by whoever ends up owning them — ownership
    // nobody wants. Signing here costs one call on a path that has just made
    // three.
    const [rendered] = await toRenderedAttachments([ready])

    if (!rendered) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    return NextResponse.json(rendered)
  } catch (error) {
    console.error('[api/attachments] confirm failed', error)
    return NextResponse.json(
      { error: 'Could not confirm the upload', code: 'internal_error' },
      { status: 500 },
    )
  }
}

/** Storage enforces both at upload; this is what notices when it did not. */
function isAcceptable(mimeType: string, sizeBytes: number): boolean {
  const allowed: readonly string[] = ALLOWED_ATTACHMENT_MIME_TYPES

  return allowed.includes(mimeType) && sizeBytes > 0 && sizeBytes <= MAX_ATTACHMENT_BYTES
}
