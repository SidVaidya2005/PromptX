/**
 * Rendering a conversation into a file somebody downloads. (F34)
 *
 * Pure, taking rows that have already been read. That is the split `share.ts`
 * and `compare.ts` already make and it is not stylistic: `vitest.config.ts` runs
 * `tests/**` in a node environment, so a builder living inside a route handler
 * is a builder nothing in this project can test — and this whole feature is
 * string assembly, which is exactly the kind of code that fails quietly.
 */

import { MAX_TITLE_LENGTH } from '@/lib/constants'

import type { Attachment, Conversation, Message } from '@/types/domain'

export type ExportFormat = 'markdown' | 'json'

/** What the route hands the builders: the thread, plus its files by message. */
export type ExportInput = {
  conversation: Conversation
  messages: readonly Message[]
  attachments: readonly Attachment[]
}

/**
 * The conversation as Markdown.
 *
 * **Message content is inserted verbatim** — not escaped, not indented, not
 * re-wrapped. That is what "code fences preserved" means: the content already
 * *is* Markdown, so anything done to it on the way out would be damage. The
 * accepted consequence, which is inherent to exporting Markdown as Markdown: a
 * message containing its own `#` heading interleaves with this document's
 * structure, and there is no fix that does not also break the fences.
 *
 * Role labels are `##` so the H1 stays the title alone. Nothing in `DESIGN.md`
 * governs a downloaded file, so the shape here is a readability call rather than
 * a token lookup.
 */
export function toMarkdown({
  conversation,
  messages,
  attachments,
}: ExportInput): string {
  const parts: string[] = [`# ${conversation.title}`, '']

  for (const message of messages) {
    const model = message.model_id

    parts.push(
      message.role === 'assistant' && model
        ? `## Assistant — ${model}`
        : message.role === 'assistant'
          ? '## Assistant'
          : '## You',
      '',
      message.content,
      '',
    )

    const files = attachmentsFor(attachments, message.id)

    if (files.length > 0) {
      // Named, never embedded and never linked. The bytes stay where they are:
      // this file gets emailed around, and a signed URL in it would be a bearer
      // token for a private object travelling with it. (F34)
      for (const file of files) {
        parts.push(`*[Attachment: ${describe(file)}]*`)
      }

      parts.push('')
    }
  }

  return `${parts.join('\n').trimEnd()}\n`
}

/**
 * The conversation as JSON.
 *
 * **Every field is picked by name, and that is the security property.** A spread
 * of the row would export `user_id`, `share_slug`, the token counts and
 * `used_shared_key` — and would silently start exporting any column added later,
 * which is the part that makes the spread dangerous rather than merely untidy.
 *
 * `share_slug` deserves its own sentence. It is not key material, so §34's rule
 * does not name it, and exporting it would still be a mistake: it is a live
 * public URL, it would travel inside a file people forward, and revoking the
 * link afterwards cannot reach that copy.
 *
 * Token counts and `used_shared_key` are left out because §34 asks for messages,
 * models and timestamps. The smallest disclosure that satisfies the spec is the
 * right default; widening it later is easy and narrowing it is not.
 */
export function toJson({ conversation, messages, attachments }: ExportInput) {
  return {
    title: conversation.title,
    provider: conversation.provider,
    modelId: conversation.model_id,
    systemPrompt: conversation.system_prompt,
    createdAt: conversation.created_at,
    updatedAt: conversation.updated_at,
    messages: messages.map((message) => ({
      role: message.role,
      content: message.content,
      provider: message.provider,
      modelId: message.model_id,
      createdAt: message.created_at,
      attachments: attachmentsFor(attachments, message.id).map((file) => ({
        mimeType: file.mime_type,
        sizeBytes: file.size_bytes,
        position: file.position,
      })),
    })),
  }
}

/** This message's files, in the order they were sent. */
function attachmentsFor(
  attachments: readonly Attachment[],
  messageId: string,
): readonly Attachment[] {
  return attachments
    .filter((attachment) => attachment.message_id === messageId)
    .sort((a, b) => a.position - b.position)
}

/** How a file is named in the Markdown, since nothing stores an original name. */
function describe(attachment: Attachment): string {
  return `${attachment.mime_type}, ${Math.max(1, Math.round(attachment.size_bytes / 1024))} KB`
}

/**
 * A filename for the download, derived from the title.
 *
 * **The sanitising is a header-injection guard, not tidiness.** The title is
 * whatever the user typed, and it ends up inside a `Content-Disposition`
 * response header — a carriage return or newline in it could terminate the
 * header and begin another. Control characters go first for that reason;
 * quotes, backslashes and path separators go because they break the quoted-string
 * form or reach outside the filename.
 *
 * Falls back to `conversation` rather than producing an empty name: a title of
 * `"""` sanitises to nothing, and a download called `.md` is worse than a
 * generic one.
 */
export function exportFilename(title: string, format: ExportFormat): string {
  const safe = title
    // Control characters first, and written as escapes rather than literals so
    // the intent survives being read: \r and \n are the two that could split
    // the header, and nothing else in the range belongs in a filename either.
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    // Quotes and backslashes break the quoted-string form; the path separators
    // and Windows-reserved characters reach outside the filename.
    .replace(/["'\\/:*?<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TITLE_LENGTH)

  const stem = safe === '' ? 'conversation' : safe

  return `${stem}.${format === 'json' ? 'json' : 'md'}`
}

/**
 * The `Content-Disposition` value for a download.
 *
 * Both forms, deliberately. `filename=` carries an ASCII-only fallback for
 * clients that do not implement RFC 5987; `filename*=UTF-8''…` carries the real
 * one, so a conversation titled in Japanese does not download as a row of
 * underscores. Every modern browser prefers the second when both are present.
 */
export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_')

  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}
