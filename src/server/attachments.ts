import 'server-only'

import type { FileUIPart } from 'ai'

import {
  createAttachmentReadUrls,
  downloadAttachmentBytes,
  listAttachmentsByMessageIds,
} from '@/server/data/attachments'

import type { Attachment, Message, RenderedAttachment } from '@/types/domain'

/**
 * Attachment rows plus the signed URLs a browser needs to draw them. (F29)
 *
 * Every path is signed in one call rather than one per object, because a thread
 * of four images is twelve objects and twelve round trips to render a screen.
 *
 * A path that could not be signed is simply absent, which the renderer reads the
 * same way it reads a missing derivative: fall back to the original. Only
 * `originalUrl` is required, and a row whose original cannot be signed is
 * dropped entirely — there is nothing left to show.
 */
export async function toRenderedAttachments(
  attachments: readonly Attachment[],
): Promise<RenderedAttachment[]> {
  if (attachments.length === 0) return []

  const paths = attachments.flatMap((attachment) =>
    [attachment.storage_path, attachment.thumb_path, attachment.inline_path].filter(
      (path): path is string => path !== null,
    ),
  )

  const urls = await createAttachmentReadUrls(paths)

  return attachments.flatMap((attachment) => {
    const originalUrl = urls.get(attachment.storage_path)
    if (!originalUrl) return []

    return [
      {
        id: attachment.id,
        mimeType: attachment.mime_type,
        position: attachment.position,
        thumbUrl: attachment.thumb_path
          ? (urls.get(attachment.thumb_path) ?? null)
          : null,
        inlineUrl: attachment.inline_path
          ? (urls.get(attachment.inline_path) ?? null)
          : null,
        originalUrl,
        width: attachment.inline_width,
        height: attachment.inline_height,
      },
    ]
  })
}

/**
 * Every message's attachments, ready to render, keyed by message id. (F29)
 *
 * Keyed rather than folded into the messages themselves, because the thread is
 * `useChat` state in the browser: a message sent moments ago exists only there,
 * and no server render can reach it to add parts. A map beside the messages is
 * something the client can add to optimistically and re-key when the server
 * reports which row the prompt became.
 */
export async function attachmentsByMessage(
  messages: readonly Message[],
): Promise<Record<string, RenderedAttachment[]>> {
  const attachments = await listAttachmentsByMessageIds(
    messages.map((message) => message.id),
  )

  const rendered = await toRenderedAttachments(attachments)
  const byId = new Map(attachments.map((row) => [row.id, row.message_id]))

  const grouped: Record<string, RenderedAttachment[]> = {}

  for (const attachment of rendered) {
    const messageId = byId.get(attachment.id)
    if (!messageId) continue

    grouped[messageId] = [...(grouped[messageId] ?? []), attachment]
  }

  return grouped
}

/**
 * Turns attachment rows into the file parts a model actually reads. (F29)
 *
 * **The bytes are inlined as data URLs; no signed URL is ever handed to a
 * provider.** A signed URL is a bearer token for a user's private file, and
 * passing one to Google puts it in a third party's logs for as long as it lives.
 * It is rarely even cheaper: a provider that cannot fetch arbitrary URLs makes
 * the AI SDK download them through this same process anyway, just at a moment
 * nothing here chose.
 *
 * **Every turn that has attachments gets them, not only the newest.** A
 * conversation about an image is unusable otherwise — ask a follow-up two
 * messages later and the model answers confidently about nothing, with nothing
 * on screen to explain why. The accepted cost is that the same image is re-sent
 * and re-billed each turn, which is also why the `_inline` derivative is what
 * gets sent: 1440px of webp instead of the original, every time.
 *
 * Nothing here reads the client's own message parts. `chatSendSchema` accepts
 * text and only text, so the file parts a model sees are built from rows the
 * route has already proved are ready, unlinked and the caller's — otherwise a
 * client could hand the model arbitrary content through a part the schema had
 * started to accept.
 */
export async function buildFileParts(options: {
  /**
   * What this model will read. (F30)
   *
   * A predicate rather than a model id, so this function stays about bytes and
   * the catalog stays the caller's business — `acceptedMimeTypes()` is the one
   * definition and this is a caller of it, not a second copy.
   *
   * **History is filtered, not refused.** A model that cannot read an earlier
   * image simply does not receive it, so one picture in turn one does not bar
   * every text-only model from the conversation for good. The cost is real and
   * belongs on the record rather than in a comment nobody reads: the model
   * silently cannot see something the thread visibly contains, and nothing on
   * screen says so. The *current* turn never reaches this state — the route
   * refuses an unreadable attachment outright, above the provider line.
   */
  accepts: (mimeType: string) => boolean
  /** The stored thread, whose message ids are also its UI message ids. */
  history: readonly Message[]
  /**
   * The turn being sent right now, if it carries anything. Keyed separately
   * because its UI id is the one the client minted — the row it became is not
   * written until later, and the model has to see the files under the id the
   * history array actually uses.
   */
  newest?: { messageId: string; attachments: readonly Attachment[] }
}): Promise<Map<string, FileUIPart[]>> {
  const parts = new Map<string, FileUIPart[]>()

  const historyAttachments = await listAttachmentsByMessageIds(
    options.history.map((message) => message.id),
  )

  for (const attachment of historyAttachments) {
    const messageId = attachment.message_id
    if (!messageId) continue

    // Dropped for a model that cannot read it, rather than sent and refused by
    // the provider. See the note on `accepts`.
    if (!options.accepts(mediaTypeOf(attachment))) continue

    // A stale row whose object has gone is skipped rather than fatal. It is an
    // old turn; refusing the whole request would make one missing file into a
    // conversation that can never be answered again.
    const part = await toFilePart(attachment)
    if (!part) continue

    parts.set(messageId, [...(parts.get(messageId) ?? []), part])
  }

  if (options.newest) {
    const built: FileUIPart[] = []

    for (const attachment of options.newest.attachments) {
      const part = await toFilePart(attachment)

      // Fatal here, unlike above, and the asymmetry is the point: this file was
      // attached moments ago by someone who is waiting for an answer about it.
      // Answering about nothing is worse than failing.
      if (!part) {
        throw new Error(`could not read attachment ${attachment.id} for this turn`)
      }

      built.push(part)
    }

    if (built.length > 0) parts.set(options.newest.messageId, built)
  }

  return parts
}

/**
 * One row as a file part, or null when its bytes cannot be read.
 *
 * Images are sent as their `_inline` derivative — a model has no use for the
 * full-resolution original, and this one is re-sent on every later turn. PDFs,
 * and images whose browser could not derive anything, fall back to the original,
 * which is what a null `inline_path` means everywhere else too.
 */
async function toFilePart(attachment: Attachment): Promise<FileUIPart | null> {
  const path = attachment.inline_path ?? attachment.storage_path
  const mediaType = mediaTypeOf(attachment)

  const bytes = await downloadAttachmentBytes(path)
  if (!bytes) return null

  return {
    type: 'file',
    mediaType,
    url: `data:${mediaType};base64,${Buffer.from(bytes).toString('base64')}`,
  }
}

/**
 * The media type of the object actually sent, which is not always the row's.
 *
 * An image is sent as its `_inline` derivative, and that is webp whatever the
 * original was — so the type has to follow the path rather than `mime_type`,
 * which describes the file the user chose. A PDF has no derivative and keeps its
 * own type.
 *
 * The capability filter reads this too, and must: a model is asked whether it
 * can read what is about to be sent, not what was uploaded. Both are images
 * today, so the distinction changes no answer — it is here so it cannot start
 * changing one silently.
 */
function mediaTypeOf(attachment: Attachment): string {
  return attachment.inline_path ? 'image/webp' : attachment.mime_type
}
