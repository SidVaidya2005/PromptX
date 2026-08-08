import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Attachment, Message } from '@/types/domain'

/**
 * The seam between stored attachment rows and the two things that consume them:
 * a browser, which gets signed URLs, and a model, which must never get one.
 *
 * That asymmetry is the reason this file exists. A signed URL is a bearer token
 * for a user's private file — handing one to Google puts it in a third party's
 * logs for as long as it lives, and nothing on screen would ever say so. The
 * bytes are therefore inlined as data URLs, and the test for it asserts on the
 * whole serialised payload rather than on the shape of each part, because what
 * it guards against is a URL arriving through a field nobody thought to name.
 * (The F33/F34 rule, applied to a provider request instead of an export.)
 *
 * The data module is mocked. Its own round trips belong to
 * `tests/server/data-attachments.test.ts`; what is under test here is which
 * object gets sent, under which media type, and what happens when one is gone.
 */

const listAttachmentsByMessageIds = vi.fn()
const downloadAttachmentBytes = vi.fn()
const createAttachmentReadUrls = vi.fn()

vi.mock('@/server/data/attachments', () => ({
  listAttachmentsByMessageIds,
  downloadAttachmentBytes,
  createAttachmentReadUrls,
}))

const OWNER = '00000000-0000-4000-8000-0000000000aa'
const PROMPT_ID = '00000000-0000-4000-8000-0000000000b1'

function attachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    id: '00000000-0000-4000-8000-0000000000d1',
    user_id: OWNER,
    message_id: PROMPT_ID,
    position: 0,
    storage_path: `${OWNER}/file.png`,
    thumb_path: `${OWNER}/file_thumb.webp`,
    inline_path: `${OWNER}/file_inline.webp`,
    inline_width: 1440,
    inline_height: 900,
    mime_type: 'image/png',
    size_bytes: 4096,
    status: 'ready',
    created_at: '2026-08-01T00:00:00.000Z',
    ...overrides,
  } as Attachment
}

function message(id: string): Message {
  return { id, role: 'user', content: 'look at this' } as Message
}

const acceptsEverything = () => true

beforeEach(() => {
  vi.resetModules()
  listAttachmentsByMessageIds.mockReset()
  downloadAttachmentBytes.mockReset()
  createAttachmentReadUrls.mockReset()

  listAttachmentsByMessageIds.mockResolvedValue([])
  downloadAttachmentBytes.mockResolvedValue(new Uint8Array([1, 2, 3]))
  createAttachmentReadUrls.mockResolvedValue(new Map())
})

async function loadModule() {
  return import('@/server/attachments')
}

describe('what a model is sent', () => {
  it('inlines the bytes and hands over no URL of any kind', async () => {
    // The invariant, asserted against the serialised payload: a signed URL
    // reaching a provider is the failure this whole design exists to prevent,
    // and it could arrive through any field.
    createAttachmentReadUrls.mockResolvedValue(
      new Map([[`${OWNER}/file_inline.webp`, 'https://storage.example/signed?token=secret']]),
    )
    listAttachmentsByMessageIds.mockResolvedValue([attachment()])

    const { buildFileParts } = await loadModule()

    const parts = await buildFileParts({
      accepts: acceptsEverything,
      history: [message(PROMPT_ID)],
    })

    const payload = JSON.stringify([...parts.values()])
    expect(payload).toContain('data:image/webp;base64,')
    expect(payload).not.toContain('https://')
    expect(payload).not.toContain('token=')
    expect(createAttachmentReadUrls).not.toHaveBeenCalled()
  })

  it('sends the _inline derivative rather than the original', async () => {
    // A model has no use for full resolution, and this object is re-sent and
    // re-billed on every later turn of the conversation.
    listAttachmentsByMessageIds.mockResolvedValue([attachment()])

    const { buildFileParts } = await loadModule()
    await buildFileParts({ accepts: acceptsEverything, history: [message(PROMPT_ID)] })

    expect(downloadAttachmentBytes).toHaveBeenCalledWith(`${OWNER}/file_inline.webp`)
  })

  it('declares the media type of the object actually sent, not the one uploaded', async () => {
    // The derivative is webp whatever the user chose, so a part labelled
    // image/png would describe a file that is not being sent.
    listAttachmentsByMessageIds.mockResolvedValue([
      attachment({ mime_type: 'image/gif' }),
    ])

    const { buildFileParts } = await loadModule()
    const parts = await buildFileParts({
      accepts: acceptsEverything,
      history: [message(PROMPT_ID)],
    })

    expect(parts.get(PROMPT_ID)?.[0]?.mediaType).toBe('image/webp')
  })

  it('falls back to the original for a PDF, which has no derivative', async () => {
    listAttachmentsByMessageIds.mockResolvedValue([
      attachment({
        mime_type: 'application/pdf',
        inline_path: null,
        thumb_path: null,
        storage_path: `${OWNER}/paper.pdf`,
      }),
    ])

    const { buildFileParts } = await loadModule()
    const parts = await buildFileParts({
      accepts: acceptsEverything,
      history: [message(PROMPT_ID)],
    })

    expect(downloadAttachmentBytes).toHaveBeenCalledWith(`${OWNER}/paper.pdf`)
    expect(parts.get(PROMPT_ID)?.[0]?.mediaType).toBe('application/pdf')
  })

  it('carries every turn’s attachments, not only the newest', async () => {
    // Without this a follow-up two messages later is answered confidently about
    // nothing, with nothing on screen to explain why.
    const olderId = '00000000-0000-4000-8000-0000000000b0'
    listAttachmentsByMessageIds.mockResolvedValue([
      attachment({ id: 'a1', message_id: olderId }),
      attachment({ id: 'a2', message_id: PROMPT_ID }),
    ])

    const { buildFileParts } = await loadModule()
    const parts = await buildFileParts({
      accepts: acceptsEverything,
      history: [message(olderId), message(PROMPT_ID)],
    })

    expect(parts.get(olderId)).toHaveLength(1)
    expect(parts.get(PROMPT_ID)).toHaveLength(1)
  })
})

describe('a model that cannot read a file', () => {
  it('is asked about the type being sent, not the type uploaded', async () => {
    // Both are images today, so this changes no answer — it is pinned so it
    // cannot start changing one silently once a derivative format differs.
    listAttachmentsByMessageIds.mockResolvedValue([
      attachment({ mime_type: 'image/gif' }),
    ])
    const accepts = vi.fn(() => true)

    const { buildFileParts } = await loadModule()
    await buildFileParts({ accepts, history: [message(PROMPT_ID)] })

    expect(accepts).toHaveBeenCalledWith('image/webp')
    expect(accepts).not.toHaveBeenCalledWith('image/gif')
  })

  it('drops an older file it cannot read rather than refusing the whole request', async () => {
    // One picture in turn one must not bar every text-only model from the
    // conversation for good. The cost is on the record: the model silently
    // cannot see something the thread visibly contains.
    listAttachmentsByMessageIds.mockResolvedValue([
      attachment({ id: 'pdf', mime_type: 'application/pdf', inline_path: null }),
      attachment({ id: 'img' }),
    ])

    const { buildFileParts } = await loadModule()
    const parts = await buildFileParts({
      accepts: (mimeType) => mimeType === 'image/webp',
      history: [message(PROMPT_ID)],
    })

    expect(parts.get(PROMPT_ID)).toHaveLength(1)
    expect(parts.get(PROMPT_ID)?.[0]?.mediaType).toBe('image/webp')
  })
})

describe('an object that is no longer there', () => {
  it('skips a stale history row, because that turn is already answered', async () => {
    listAttachmentsByMessageIds.mockResolvedValue([attachment()])
    downloadAttachmentBytes.mockResolvedValue(null)

    const { buildFileParts } = await loadModule()
    const parts = await buildFileParts({
      accepts: acceptsEverything,
      history: [message(PROMPT_ID)],
    })

    expect(parts.size).toBe(0)
  })

  it('refuses the current turn, because somebody is waiting for an answer about it', async () => {
    // The asymmetry with the case above is the whole decision: answering about
    // nothing is worse than failing when the file was attached moments ago.
    downloadAttachmentBytes.mockResolvedValue(null)

    const { buildFileParts } = await loadModule()

    await expect(
      buildFileParts({
        accepts: acceptsEverything,
        history: [],
        newest: { messageId: 'client-minted-id', attachments: [attachment()] },
      }),
    ).rejects.toThrow(/could not read attachment/)
  })

  it('keys the current turn under the id the client minted', async () => {
    // The row this prompt becomes is not written yet, so the model has to see
    // the files under the id the history array actually uses.
    const { buildFileParts } = await loadModule()

    const parts = await buildFileParts({
      accepts: acceptsEverything,
      history: [],
      newest: { messageId: 'client-minted-id', attachments: [attachment()] },
    })

    expect(parts.get('client-minted-id')).toHaveLength(1)
  })
})

describe('what a browser is sent', () => {
  it('signs every path in one call rather than one per object', async () => {
    // Three objects per image; a thread of four is twelve round trips to draw
    // one screen.
    createAttachmentReadUrls.mockResolvedValue(
      new Map([
        [`${OWNER}/file.png`, 'https://signed/original'],
        [`${OWNER}/file_thumb.webp`, 'https://signed/thumb'],
        [`${OWNER}/file_inline.webp`, 'https://signed/inline'],
      ]),
    )

    const { toRenderedAttachments } = await loadModule()
    const rendered = await toRenderedAttachments([attachment()])

    expect(createAttachmentReadUrls).toHaveBeenCalledOnce()
    expect(createAttachmentReadUrls.mock.calls[0]?.[0]).toHaveLength(3)
    expect(rendered[0]?.originalUrl).toBe('https://signed/original')
    expect(rendered[0]?.thumbUrl).toBe('https://signed/thumb')
    expect(rendered[0]?.inlineUrl).toBe('https://signed/inline')
  })

  it('drops a row whose original cannot be signed, since there is nothing to show', async () => {
    createAttachmentReadUrls.mockResolvedValue(
      new Map([[`${OWNER}/file_thumb.webp`, 'https://signed/thumb']]),
    )

    const { toRenderedAttachments } = await loadModule()

    expect(await toRenderedAttachments([attachment()])).toEqual([])
  })

  it('reads a missing derivative as null, which the renderer treats as fall back', async () => {
    createAttachmentReadUrls.mockResolvedValue(
      new Map([[`${OWNER}/file.png`, 'https://signed/original']]),
    )

    const { toRenderedAttachments } = await loadModule()
    const rendered = await toRenderedAttachments([attachment()])

    expect(rendered[0]?.thumbUrl).toBeNull()
    expect(rendered[0]?.inlineUrl).toBeNull()
  })

  it('signs nothing at all for a message with no attachments', async () => {
    const { toRenderedAttachments } = await loadModule()

    expect(await toRenderedAttachments([])).toEqual([])
    expect(createAttachmentReadUrls).not.toHaveBeenCalled()
  })

  it('groups by message id, which is what the client can re-key optimistically', async () => {
    const otherId = '00000000-0000-4000-8000-0000000000b2'
    listAttachmentsByMessageIds.mockResolvedValue([
      attachment({ id: 'a1', message_id: PROMPT_ID }),
      attachment({ id: 'a2', message_id: otherId }),
    ])
    createAttachmentReadUrls.mockResolvedValue(
      new Map([
        [`${OWNER}/file.png`, 'https://signed/original'],
        [`${OWNER}/file_thumb.webp`, 'https://signed/thumb'],
        [`${OWNER}/file_inline.webp`, 'https://signed/inline'],
      ]),
    )

    const { attachmentsByMessage } = await loadModule()
    const grouped = await attachmentsByMessage([message(PROMPT_ID), message(otherId)])

    expect(Object.keys(grouped).sort()).toEqual([PROMPT_ID, otherId].sort())
    expect(grouped[PROMPT_ID]?.[0]?.id).toBe('a1')
    expect(grouped[otherId]?.[0]?.id).toBe('a2')
  })
})
