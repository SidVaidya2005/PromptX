import 'server-only'

import { ATTACHMENT_READ_URL_TTL_SECONDS } from '@/lib/constants'

import { createServerSupabaseClient } from '@/server/supabase'

import type {
  Attachment,
  AttachmentDraft,
  AttachmentUploadTarget,
} from '@/types/domain'

/**
 * This module owns the storage objects as well as the rows, and that is a rule
 * rather than a convenience.
 *
 * Two reasons, one mechanical and one real. The mechanical one:
 * `eslint.config.mjs` restricts `CallExpression[callee.property.name='from']`
 * everywhere outside `src/server/data/`, excluding only Array, Buffer and
 * Object — so `supabase.storage.from(…)` trips that rule in any other folder.
 *
 * The real one is the invariant it protects. An image is three objects, and
 * every path that deletes an attachment has to delete all three or it strands
 * two per image — the exact leak the reaper exists to prevent, at twice the
 * rate. Keeping the paths and the rows in one file is what makes that checkable
 * by reading a single module.
 */
const BUCKET = 'attachments'

/**
 * The file extension for each accepted mime type.
 *
 * Keyed off the mime rather than taken from the uploaded filename, which is a
 * string a client chose and may not even contain a dot. The extension is
 * cosmetic — nothing reads it back — but a path ending `.png` is far easier to
 * recognise in a bucket listing than a bare uuid when something has gone wrong.
 */
const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
}

type DraftInput = {
  mimeType: string
  sizeBytes: number
  /** False for a PDF, and for an image whose browser could not derive one. */
  withDerivatives: boolean
  /** Cosmetic, client-reported, and bounded by the schema. See the migration. */
  inlineWidth?: number
  inlineHeight?: number
}

/**
 * Creates a `pending` row and the signed URLs its objects are uploaded through.
 *
 * The row comes first and the URLs second, deliberately. A signed URL issued
 * before its row would let bytes land with nothing in the database naming them,
 * and only the reaper's second pass could ever find them again. The reverse — a
 * row whose upload never happens — is the ordinary case the first pass already
 * handles.
 *
 * `userId` is passed rather than derived because the insert policy checks
 * `(select auth.uid()) = user_id` against a column this statement has to supply.
 * It is also the first path segment of every object, which is what the storage
 * policies match on: a path built any other way is unreachable by its own owner.
 *
 * `size_bytes` and `mime_type` here are the client's claim about a file it has
 * not uploaded yet. `markAttachmentReady()` replaces both with what actually
 * landed — until then nothing may treat them as facts.
 */
export async function createAttachmentDraft(
  userId: string,
  input: DraftInput,
): Promise<AttachmentDraft> {
  const supabase = await createServerSupabaseClient()

  // Minted here rather than left to the column default, because the paths are
  // built from it and the row cannot be inserted without them.
  const id = crypto.randomUUID()
  const extension = EXTENSIONS[input.mimeType] ?? 'bin'

  const storagePath = `${userId}/${id}.${extension}`
  const thumbPath = input.withDerivatives ? `${userId}/${id}_thumb.webp` : null
  const inlinePath = input.withDerivatives ? `${userId}/${id}_inline.webp` : null

  const { error } = await supabase.from('attachments').insert({
    id,
    user_id: userId,
    mime_type: input.mimeType,
    size_bytes: input.sizeBytes,
    storage_path: storagePath,
    thumb_path: thumbPath,
    inline_path: inlinePath,
    inline_width: input.withDerivatives ? (input.inlineWidth ?? null) : null,
    inline_height: input.withDerivatives ? (input.inlineHeight ?? null) : null,
    // `position` is left at its default. The real one is assigned by
    // link_attachments_to_message from the order the message was sent in — a
    // draft has no position, because the composer can still reorder it.
  })

  if (error) {
    console.error('[data/attachments] createAttachmentDraft failed', error)
    throw new Error('Failed to start the upload')
  }

  const targets: { kind: AttachmentUploadTarget['kind']; path: string }[] = [
    { kind: 'original', path: storagePath },
  ]
  if (thumbPath) targets.push({ kind: 'thumb', path: thumbPath })
  if (inlinePath) targets.push({ kind: 'inline', path: inlinePath })

  const uploads: AttachmentUploadTarget[] = []

  for (const target of targets) {
    const { data, error: urlError } = await supabase.storage
      .from(BUCKET)
      .createSignedUploadUrl(target.path)

    if (urlError || !data) {
      console.error('[data/attachments] createSignedUploadUrl failed', urlError)
      // The row stays. It is a draft with no objects, which is precisely what
      // the reaper's first pass is for — and deleting it here would be a second
      // cleanup path for a case the scheduled one already covers.
      throw new Error('Failed to start the upload')
    }

    uploads.push({
      kind: target.kind,
      path: data.path,
      token: data.token,
      signedUrl: data.signedUrl,
    })
  }

  return { id, uploads }
}

/** Returns null when the attachment does not exist or is not owned by the caller. */
export async function getAttachment(id: string): Promise<Attachment | null> {
  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase
    .from('attachments')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    console.error('[data/attachments] getAttachment failed', error)
    throw new Error('Failed to load the attachment')
  }

  return data
}

/** What Storage says actually landed at a path. Null when there is nothing there. */
export type ObjectFacts = {
  sizeBytes: number
  mimeType: string
}

/**
 * Reads an object's own metadata back out of Storage.
 *
 * This is what makes `'ready'` mean something. Everything the client told us
 * when the draft was created was a claim about bytes that had not been sent
 * yet — and the upload goes client-direct, so the application never saw them.
 * Asking Storage is the only way to find out what is really there.
 *
 * Returns null for a missing object rather than throwing, because "the upload
 * did not finish" is an expected outcome and the caller answers it with a 409.
 */
export async function readObjectFacts(path: string): Promise<ObjectFacts | null> {
  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase.storage.from(BUCKET).info(path)

  // A 404 arrives here as an error, and so would a network fault. Both mean the
  // same thing to the caller — we cannot confirm this object exists — and
  // neither may flip a row to 'ready'.
  if (error || !data) return null

  return {
    sizeBytes: data.size ?? 0,
    mimeType: data.contentType ?? '',
  }
}

/**
 * Flips a draft to `'ready'`, recording what actually landed.
 *
 * `size_bytes` and `mime_type` are overwritten with the measured values rather
 * than left as the client's estimate, so the row is a record of the object
 * instead of a record of an intention. Same posture as F17's ledger, which
 * writes only measured tokens.
 *
 * Scoped to rows with no `message_id`: once an attachment has been sent with a
 * message it is history, and a confirm call must not be able to rewrite it.
 * Returns null when nothing matched, which covers not-owned, already-sent, and
 * never-existed alike — the caller turns that into a 404.
 */
export async function markAttachmentReady(
  id: string,
  facts: ObjectFacts,
): Promise<Attachment | null> {
  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase
    .from('attachments')
    .update({
      status: 'ready',
      size_bytes: facts.sizeBytes,
      mime_type: facts.mimeType,
    })
    .eq('id', id)
    .is('message_id', null)
    .select('*')
    .maybeSingle()

  if (error) {
    console.error('[data/attachments] markAttachmentReady failed', error)
    throw new Error('Failed to confirm the upload')
  }

  return data
}

/**
 * The rows behind a set of ids, for the send path to check before it commits.
 *
 * Ownership is RLS's answer, not a filter here: an id belonging to someone else
 * simply does not come back, so a short result is how the route learns that one
 * of the ids was never the caller's.
 */
export async function listAttachmentsByIds(ids: string[]): Promise<Attachment[]> {
  if (ids.length === 0) return []

  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase.from('attachments').select('*').in('id', ids)

  if (error) {
    console.error('[data/attachments] listAttachmentsByIds failed', error)
    throw new Error('Failed to load attachments')
  }

  return data
}

/**
 * Attaches ready drafts to a message, in the order given.
 *
 * Returns how many rows actually moved. The caller compares that against the
 * number of ids it sent and treats a shortfall as a failure — see the migration
 * for why this is one statement rather than four updates, and why the ready and
 * unlinked conditions are repeated inside it rather than trusted from the check
 * the route already made.
 */
export async function linkAttachmentsToMessage(
  messageId: string,
  ids: string[],
): Promise<number> {
  if (ids.length === 0) return 0

  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase.rpc('link_attachments_to_message', {
    p_message_id: messageId,
    p_ids: ids,
  })

  if (error) {
    console.error('[data/attachments] linkAttachmentsToMessage failed', error)
    throw new Error('Failed to attach the files')
  }

  return data ?? 0
}

/**
 * Every attachment linked to any of these messages, in render order.
 *
 * One query for a whole thread rather than one per message: a fifty-message
 * conversation would otherwise be fifty round trips to draw a handful of
 * thumbnails. Ordered by `(message_id, position)` so the caller can group
 * without re-sorting, and `position` is what the composer's arrangement became.
 */
export async function listAttachmentsByMessageIds(
  messageIds: string[],
): Promise<Attachment[]> {
  if (messageIds.length === 0) return []

  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase
    .from('attachments')
    .select('*')
    .in('message_id', messageIds)
    .order('message_id')
    .order('position')

  if (error) {
    console.error('[data/attachments] listAttachmentsByMessageIds failed', error)
    throw new Error('Failed to load attachments')
  }

  return data
}

/**
 * The bytes of one object, for handing to a model.
 *
 * This is the one place an attachment's contents pass through the Node process,
 * and it is deliberate: the alternative is giving a provider a signed URL, which
 * is a bearer token for a user's private file sitting in a third party's logs
 * for as long as it lives. It is rarely even more expensive — a provider that
 * cannot fetch arbitrary URLs makes the AI SDK download them through here
 * anyway, just at a moment nothing chose.
 *
 * Callers pass `inline_path` for an image, which is a fraction of the original
 * and is re-sent on every subsequent turn.
 */
export async function downloadAttachmentBytes(path: string): Promise<Uint8Array | null> {
  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase.storage.from(BUCKET).download(path)

  if (error || !data) {
    console.error('[data/attachments] downloadAttachmentBytes failed', error)
    return null
  }

  return new Uint8Array(await data.arrayBuffer())
}

/**
 * Deletes an attachment and all three of its storage objects.
 *
 * Objects first, row second — the reaper's ordering, for the reaper's reason. A
 * failure between them leaves a row pointing at a file that is gone, which the
 * next sweep clears harmlessly; the reverse strands the file forever with
 * nothing left naming it.
 *
 * Scoped to unlinked drafts. Once an attachment has been sent with a message it
 * belongs to the thread, and removing it is a different operation than
 * withdrawing something from the composer — one this feature does not offer.
 *
 * Returns false when nothing matched, which the route turns into a 404.
 */
export async function deleteAttachment(id: string): Promise<boolean> {
  const supabase = await createServerSupabaseClient()

  const attachment = await getAttachment(id)
  if (!attachment || attachment.message_id !== null) return false

  const paths = [
    attachment.storage_path,
    attachment.thumb_path,
    attachment.inline_path,
  ].filter((path): path is string => path !== null)

  const { error: removeError } = await supabase.storage.from(BUCKET).remove(paths)

  if (removeError) {
    console.error('[data/attachments] could not remove objects', removeError)
    throw new Error('Failed to remove the attachment')
  }

  const { data, error } = await supabase
    .from('attachments')
    .delete()
    .eq('id', id)
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('[data/attachments] deleteAttachment failed', error)
    throw new Error('Failed to remove the attachment')
  }

  return data !== null
}

/**
 * Short-lived signed URLs for reading objects, generated server-side.
 *
 * The bucket is private and stays private, so this is the only way a browser
 * reads an attachment. Keyed by path in the returned map because a message's
 * three objects are asked for together and the caller needs to know which URL
 * belongs to which column.
 *
 * A path that cannot be signed is simply absent from the map rather than
 * throwing — one missing derivative should degrade to the original, not blank
 * the message it belongs to.
 */
export async function createAttachmentReadUrls(
  paths: string[],
): Promise<Map<string, string>> {
  const urls = new Map<string, string>()
  if (paths.length === 0) return urls

  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrls(paths, ATTACHMENT_READ_URL_TTL_SECONDS)

  if (error || !data) {
    console.error('[data/attachments] createAttachmentReadUrls failed', error)
    throw new Error('Failed to load attachments')
  }

  for (const entry of data) {
    if (entry.path && entry.signedUrl) urls.set(entry.path, entry.signedUrl)
  }

  return urls
}
