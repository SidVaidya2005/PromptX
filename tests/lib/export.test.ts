import { describe, expect, it } from 'vitest'

import {
  contentDisposition,
  exportFilename,
  toJson,
  toMarkdown,
  type ExportInput,
} from '@/lib/export'

import type { Attachment, Conversation, Message } from '@/types/domain'

const USER_ID = '99999999-8888-4777-8666-555555555555'

/**
 * A fence, kept in its own constant so the assertion can look for the exact
 * string. The whole point of "code fences preserved" is that nothing on the way
 * out escapes, indents or re-wraps it.
 */
const FENCE = ['```ts', 'const x: number = 1', '```'].join('\n')

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'c1',
    user_id: USER_ID,
    title: 'A conversation',
    provider: 'google',
    model_id: 'gemini-3.6-flash',
    system_prompt: null,
    pinned_at: null,
    archived_at: null,
    share_slug: null,
    shared_at: null,
    created_at: '2026-08-01T10:00:00Z',
    updated_at: '2026-08-01T10:05:00Z',
    ...overrides,
  } as Conversation
}

function message(overrides: Partial<Message> & { id: string }): Message {
  return {
    conversation_id: 'c1',
    user_id: USER_ID,
    role: 'user',
    content: 'hello',
    status: 'complete',
    provider: null,
    model_id: null,
    input_tokens: null,
    output_tokens: null,
    used_shared_key: false,
    error_message: null,
    created_at: '2026-08-01T10:00:00Z',
    search_vector: null,
    ...overrides,
  } as Message
}

function attachment(overrides: Partial<Attachment> & { id: string }): Attachment {
  return {
    user_id: USER_ID,
    message_id: 'm1',
    storage_path: `${USER_ID}/file.png`,
    thumb_path: null,
    inline_path: null,
    inline_width: null,
    inline_height: null,
    mime_type: 'image/png',
    size_bytes: 2048,
    position: 0,
    status: 'ready',
    created_at: '2026-08-01T10:00:00Z',
    ...overrides,
  } as Attachment
}

const thread: ExportInput = {
  conversation: conversation(),
  messages: [
    message({ id: 'm1', role: 'user', content: 'How do I type this?' }),
    message({
      id: 'm2',
      role: 'assistant',
      content: `Like this:\n\n${FENCE}`,
      provider: 'google',
      model_id: 'gemini-3.6-flash',
    }),
  ],
  attachments: [attachment({ id: 'a1', message_id: 'm1' })],
}

describe('toMarkdown', () => {
  it('opens with the title as the only H1', () => {
    const lines = toMarkdown(thread).split('\n')

    expect(lines[0]).toBe('# A conversation')
    expect(lines.filter((line) => line.startsWith('# '))).toHaveLength(1)
  })

  it('labels each role and names the model on the assistant turn', () => {
    const markdown = toMarkdown(thread)

    expect(markdown).toContain('## You')
    expect(markdown).toContain('## Assistant — gemini-3.6-flash')
  })

  it('preserves a code fence byte for byte', () => {
    // The assertion that justifies inserting content verbatim. Escaping,
    // indenting or re-wrapping would each leave a document that still looks
    // plausible and no longer round-trips.
    expect(toMarkdown(thread)).toContain(FENCE)
  })

  it('names an attachment without linking to it', () => {
    const markdown = toMarkdown(thread)

    expect(markdown).toContain('[Attachment: image/png')
    // No object, no signed URL, no storage path. This file gets forwarded.
    expect(markdown).not.toContain('storage/v1')
    expect(markdown).not.toContain(USER_ID)
  })

  it('ends with exactly one trailing newline', () => {
    const markdown = toMarkdown(thread)

    expect(markdown.endsWith('\n')).toBe(true)
    expect(markdown.endsWith('\n\n')).toBe(false)
  })
})

describe('toJson', () => {
  it('carries the messages, models and timestamps §34 asks for', () => {
    const payload = toJson(thread)

    expect(payload.title).toBe('A conversation')
    expect(payload.messages).toHaveLength(2)
    expect(payload.messages[1]).toMatchObject({
      role: 'assistant',
      modelId: 'gemini-3.6-flash',
      createdAt: '2026-08-01T10:00:00Z',
    })
  })

  it('leaks no user id, share slug, token counts or key usage', () => {
    /**
     * **The test the whole shape of `toJson` exists for.**
     *
     * Asserted against the SERIALISED payload rather than field by field,
     * because the failure this guards against is a field nobody named — a
     * spread of the row today, or a column added to `messages` in two features'
     * time. Picking by name is what makes that impossible; this is what notices
     * if somebody stops.
     */
    const serialised = JSON.stringify(
      toJson({
        ...thread,
        conversation: conversation({ share_slug: 'liveSlug1234' } as Partial<Conversation>),
        messages: [
          message({
            id: 'm3',
            role: 'assistant',
            content: 'billed',
            input_tokens: 111,
            output_tokens: 222,
            used_shared_key: true,
          }),
        ],
      }),
    )

    expect(serialised).not.toContain(USER_ID)
    expect(serialised).not.toContain('user_id')
    // A live public URL travelling inside a file people forward, which revoking
    // the link afterwards cannot reach.
    expect(serialised).not.toContain('liveSlug1234')
    expect(serialised).not.toContain('share')
    expect(serialised).not.toContain('111')
    expect(serialised).not.toContain('222')
    expect(serialised).not.toContain('usedSharedKey')
  })

  it('describes an attachment without its path', () => {
    const payload = toJson(thread)

    expect(payload.messages[0]?.attachments).toEqual([
      { mimeType: 'image/png', sizeBytes: 2048, position: 0 },
    ])
  })
})

describe('exportFilename', () => {
  it('uses the title and the format’s extension', () => {
    expect(exportFilename('Three sea creatures', 'markdown')).toBe(
      'Three sea creatures.md',
    )
    expect(exportFilename('Three sea creatures', 'json')).toBe(
      'Three sea creatures.json',
    )
  })

  it('strips the characters that could split a response header', () => {
    // The guard, stated as a test. A title is whatever somebody typed, and it
    // reaches a Content-Disposition header — a CRLF in it could terminate that
    // header and begin another.
    const nasty = exportFilename('evil\r\nX-Injected: yes', 'markdown')

    expect(nasty).not.toContain('\r')
    expect(nasty).not.toContain('\n')
    expect(nasty).toBe('evil X-Injected yes.md')
  })

  it('strips quotes and path separators', () => {
    expect(exportFilename('a"b/c\\d:e', 'json')).toBe('abcde.json')
  })

  it('falls back rather than producing a nameless file', () => {
    // A title of only quotes sanitises to nothing, and a download called `.md`
    // is worse than a generic name.
    expect(exportFilename('"""', 'markdown')).toBe('conversation.md')
    expect(exportFilename('   ', 'json')).toBe('conversation.json')
  })
})

describe('contentDisposition', () => {
  it('marks the response as an attachment and carries both filename forms', () => {
    const header = contentDisposition('notes.md')

    expect(header).toContain('attachment;')
    expect(header).toContain('filename="notes.md"')
    expect(header).toContain("filename*=UTF-8''notes.md")
  })

  it('keeps the ASCII fallback ASCII while the encoded form keeps the original', () => {
    // A Japanese title must not download as underscores on a client that reads
    // the encoded form, and must not break one that does not.
    const header = contentDisposition('日本語.md')

    expect(header).toContain('filename="___.md"')
    expect(header).toContain(`filename*=UTF-8''${encodeURIComponent('日本語.md')}`)
  })
})
