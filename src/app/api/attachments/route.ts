import { NextResponse } from 'next/server'

import { createAttachmentSchema } from '@/lib/schemas'

import { getUser } from '@/server/auth'
import { createAttachmentDraft } from '@/server/data/attachments'

export const runtime = 'nodejs'

/**
 * Starts an upload: creates a `pending` row and returns the signed URLs its
 * objects are uploaded through. (F28)
 *
 * **The Node process is never in the byte path**, and that is the design rather
 * than an optimisation. This service is a single free instance that is also
 * holding streaming responses open; putting a 10 MB upload — let alone an image
 * resize — on that request path would make every attachment compete with every
 * answer being read. So the client uploads straight to Storage, and this route
 * only ever hands out permission to.
 *
 * The consequence to keep in view: **nothing this handler validates constrains
 * what actually lands.** Mime and size are checked here so an obviously
 * impossible upload is refused before it starts, but the bucket's
 * `file_size_limit` and `allowed_mime_types` are what enforce them at the moment
 * bytes arrive, and `/api/attachments/[id]/confirm` is what measures the result.
 *
 * Up to three URLs come back — the original, and for an image whose browser
 * could derive them, `_thumb` and `_inline`. Each is issued against its own path
 * under `{user_id}/`, which is the segment the storage policies match on.
 */
export async function POST(request: Request) {
  const user = await getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = createAttachmentSchema.safeParse(await request.json())
  if (!parsed.success) {
    console.error('[api/attachments] invalid create', parsed.error)
    return NextResponse.json(
      { error: 'That file cannot be attached', code: 'invalid_input' },
      { status: 400 },
    )
  }

  try {
    const draft = await createAttachmentDraft(user.id, {
      mimeType: parsed.data.mimeType,
      sizeBytes: parsed.data.sizeBytes,
      withDerivatives: parsed.data.withDerivatives,
      inlineWidth: parsed.data.inlineWidth,
      inlineHeight: parsed.data.inlineHeight,
    })

    return NextResponse.json(draft, { status: 201 })
  } catch (error) {
    console.error('[api/attachments] create failed', error)
    return NextResponse.json(
      { error: 'Could not start the upload', code: 'internal_error' },
      { status: 500 },
    )
  }
}
