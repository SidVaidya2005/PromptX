/**
 * Image derivatives, produced in the browser before an upload. (F28)
 *
 * **Nothing here ever runs on the server, and that is the point.** The Node
 * process is one free instance already holding streaming responses open; a
 * resize on the request path would put every attachment in competition with
 * every answer being read. Uploads go client-direct to Storage, so the only
 * machine that ever sees an image byte is the one that chose the file.
 *
 * Everything is best-effort. A browser without `OffscreenCanvas`, an image the
 * decoder refuses, a codec that will not encode webp — each returns null, the
 * original is uploaded alone, and `thumb_path` / `inline_path` stay null. The
 * renderer reads a null as "use the original", so a failure here costs bandwidth
 * and never correctness.
 */

import {
  ATTACHMENT_DERIVATIVE_MIME,
  ATTACHMENT_INLINE_MAX_PX,
  ATTACHMENT_THUMB_PX,
} from '@/lib/constants'

import type { Attachment, AttachmentDraft } from '@/types/domain'

/** The two webp renderings of one image, or null when none could be made. */
export type ImageDerivatives = {
  thumb: Blob
  inline: Blob
}

/**
 * Runs one file through the whole pipeline: derive, ask, upload, confirm.
 *
 * The three steps are in this order for a reason each. Derivatives come first
 * because whether they exist decides how many signed URLs to ask for. The row
 * is created before any byte is sent, so an object can never exist with nothing
 * in the database naming it — the one leak only the reaper's second pass can
 * find. And the confirm call is last, because it is the server measuring what
 * landed; nothing may treat this attachment as usable until it returns.
 *
 * The bytes go straight to Storage, never through the application. `signedUrl`
 * already carries its own token, so this is a plain `PUT` — the same request
 * `uploadToSignedUrl()` makes, without needing a browser Supabase client here.
 *
 * Throws on any failure. The caller decides what that means: F29's composer
 * marks the file failed and offers a retry, while whatever is already in Storage
 * is left to the reaper rather than cleaned up in a loop.
 */
export async function uploadAttachment(file: File): Promise<Attachment> {
  const derivatives = await createImageDerivatives(file)

  const draftResponse = await fetch('/api/attachments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mimeType: file.type,
      sizeBytes: file.size,
      withDerivatives: derivatives !== null,
    }),
  })

  if (!draftResponse.ok) {
    throw new Error(await errorMessage(draftResponse, 'Could not start the upload'))
  }

  const draft = (await draftResponse.json()) as AttachmentDraft

  for (const target of draft.uploads) {
    const body =
      target.kind === 'original'
        ? file
        : target.kind === 'thumb'
          ? derivatives?.thumb
          : derivatives?.inline

    // Only reachable if the server issued a derivative URL we did not ask for.
    if (!body) throw new Error(`no body for the ${target.kind} upload`)

    const upload = await fetch(target.signedUrl, {
      method: 'PUT',
      headers: { 'Content-Type': body.type },
      body,
    })

    // Where the bucket's own limits speak: a file over file_size_limit or off
    // allowed_mime_types is refused here, by Storage, after every check this
    // application made had already passed.
    if (!upload.ok) {
      throw new Error(`upload of the ${target.kind} object failed (${upload.status})`)
    }
  }

  const confirmed = await fetch(`/api/attachments/${draft.id}/confirm`, { method: 'POST' })

  if (!confirmed.ok) {
    throw new Error(await errorMessage(confirmed, 'That upload did not finish'))
  }

  return (await confirmed.json()) as Attachment
}

/** The route's own sentence when there is one, since every one of them is safe to show. */
async function errorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string }
    return body.error ?? fallback
  } catch {
    return fallback
  }
}

/**
 * Produces an 80px square thumb and a 1440px longest-edge inline copy.
 *
 * Returns null for a PDF, for a browser that cannot do this, and for any image
 * that fails to decode — all three are the same outcome to the caller, which is
 * why they are not distinguished. The upload proceeds with the original alone.
 *
 * A GIF yields a still first frame, which is what `createImageBitmap` decodes.
 * That is correct for both derivatives: the chip and the message column want a
 * stable image, and the lightbox opens the original, which still animates.
 */
export async function createImageDerivatives(
  file: Blob,
): Promise<ImageDerivatives | null> {
  if (!file.type.startsWith('image/')) return null
  if (typeof createImageBitmap !== 'function') return null
  if (typeof OffscreenCanvas !== 'function') return null

  let bitmap: ImageBitmap | null = null

  try {
    // `from-image` explicitly, rather than trusting the default. A photograph
    // taken on a phone carries its rotation in EXIF, and a decoder that ignores
    // it produces a sideways thumbnail beside an original that displays the
    // right way up — which reads as a broken thumbnail, not as a setting.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })

    const thumb = await renderThumb(bitmap)
    const inline = await renderInline(bitmap)

    if (!thumb || !inline) return null

    return { thumb, inline }
  } catch {
    // Deliberately silent and deliberately total. Every failure in here means
    // the same thing — no derivatives — and there is nothing a user could do
    // about any of them.
    return null
  } finally {
    bitmap?.close()
  }
}

/**
 * A square centre crop, because the chip it feeds is square.
 *
 * Letterboxing instead would mean either a fill colour behind every thumbnail —
 * DESIGN.md has no token for that surface — or transparency that shows the row
 * hover through the image. A crop keeps the frame full at every aspect ratio.
 */
async function renderThumb(bitmap: ImageBitmap): Promise<Blob | null> {
  const edge = Math.min(bitmap.width, bitmap.height)
  const sx = (bitmap.width - edge) / 2
  const sy = (bitmap.height - edge) / 2

  const canvas = new OffscreenCanvas(ATTACHMENT_THUMB_PX, ATTACHMENT_THUMB_PX)
  const context = canvas.getContext('2d')
  if (!context) return null

  context.drawImage(
    bitmap,
    sx,
    sy,
    edge,
    edge,
    0,
    0,
    ATTACHMENT_THUMB_PX,
    ATTACHMENT_THUMB_PX,
  )

  return canvas.convertToBlob({ type: ATTACHMENT_DERIVATIVE_MIME })
}

/**
 * The whole image, scaled so its longest edge is at most 1440px.
 *
 * **Never upscaled.** An image already smaller than the bound is re-encoded at
 * its own size, so a 200px avatar does not become a blurry 1440px one that is
 * also several times larger than the file it was derived from.
 */
async function renderInline(bitmap: ImageBitmap): Promise<Blob | null> {
  const longest = Math.max(bitmap.width, bitmap.height)
  const scale = longest > ATTACHMENT_INLINE_MAX_PX ? ATTACHMENT_INLINE_MAX_PX / longest : 1

  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))

  const canvas = new OffscreenCanvas(width, height)
  const context = canvas.getContext('2d')
  if (!context) return null

  context.drawImage(bitmap, 0, 0, width, height)

  return canvas.convertToBlob({ type: ATTACHMENT_DERIVATIVE_MIME })
}
