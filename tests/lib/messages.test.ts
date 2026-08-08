import { describe, expect, it } from 'vitest'

import { toUIMessages, withFileParts } from '@/lib/messages'

import type { Message } from '@/types/domain'

function row(overrides: Partial<Message> & { id: string }): Message {
  return {
    conversation_id: 'c1',
    user_id: 'u1',
    role: 'user',
    content: 'hello',
    provider: null,
    model_id: null,
    used_shared_key: false,
    input_tokens: null,
    output_tokens: null,
    status: 'complete',
    error_message: null,
    created_at: '2026-08-01T00:00:00Z',
    ...overrides,
  } as Message
}

/**
 * This mapping decides what a thread looks like after a reload, which is the
 * only moment the database and the screen have to agree.
 */
describe('toUIMessages', () => {
  it('turns a row into a single text part', () => {
    expect(toUIMessages([row({ id: 'm1', content: 'Explain RLS' })])).toEqual([
      {
        id: 'm1',
        role: 'user',
        metadata: { status: 'complete', errorMessage: null, modelId: null },
        parts: [{ type: 'text', text: 'Explain RLS' }],
      },
    ])
  })

  it('reuses the row id as the message id', () => {
    // A fresh id per render would make React tear the thread down and rebuild
    // it on every reload.
    const [message] = toUIMessages([row({ id: 'row-id-kept' })])
    expect(message?.id).toBe('row-id-kept')
  })

  it('carries the failure through as metadata', () => {
    // Without this the error styling survives only until the page reloads, and
    // a failed answer comes back looking like an ordinary one.
    const [message] = toUIMessages([
      row({
        id: 'm2',
        role: 'assistant',
        content: 'partial ans',
        status: 'error',
        error_message: 'Generation stopped',
        model_id: 'gemini-3.6-flash',
      }),
    ])

    expect(message?.metadata).toEqual({
      status: 'error',
      errorMessage: 'Generation stopped',
      modelId: 'gemini-3.6-flash',
    })
  })

  it('carries the model that produced the response', () => {
    // The meta line falls back to the composer's model when this is missing,
    // which is right for a live stream and wrong for a reloaded thread whose
    // model changed partway. The row has to be the authority.
    const [message] = toUIMessages([
      row({ id: 'm4', role: 'assistant', model_id: 'gemini-3.6-flash' }),
    ])

    expect(message?.metadata?.modelId).toBe('gemini-3.6-flash')
  })

  it('keeps a message that failed before producing anything', () => {
    // Dropping empty content here would make the row vanish from the thread
    // while still sitting in the database.
    const [message] = toUIMessages([
      row({ id: 'm3', role: 'assistant', content: '', status: 'error' }),
    ])

    expect(message?.parts).toEqual([{ type: 'text', text: '' }])
  })

  it('preserves order and handles an empty thread', () => {
    expect(toUIMessages([]).length).toBe(0)
    expect(
      toUIMessages([row({ id: 'a' }), row({ id: 'b' }), row({ id: 'c' })]).map(
        (m) => m.id,
      ),
    ).toEqual(['a', 'b', 'c'])
  })
})

/**
 * What a model is actually shown. (F29)
 *
 * The order is the assertion that matters: files before text, because that is
 * the order the sentence assumes — "here is the image, now my question about
 * it". A model given the question first has to hold it until the attachment
 * arrives, and on a long thread that is several turns later.
 */
describe('withFileParts', () => {
  const file = {
    type: 'file' as const,
    mediaType: 'image/webp',
    url: 'data:image/webp;base64,AAAA',
  }

  it('puts a message’s files ahead of its text', () => {
    const [message] = withFileParts(toUIMessages([row({ id: 'm1', content: 'what is this?' })]), new Map([['m1', [file]]]))

    expect(message?.parts.map((part) => part.type)).toEqual(['file', 'text'])
  })

  it('leaves a message with no files exactly as it was', () => {
    const messages = toUIMessages([row({ id: 'm1' }), row({ id: 'm2' })])
    const result = withFileParts(messages, new Map([['m1', [file]]]))

    // Identity, not equality: an untouched message must not be rebuilt, or every
    // render downstream sees a new object for a message that did not change.
    expect(result[1]).toBe(messages[1])
    expect(result[0]).not.toBe(messages[0])
  })

  it('carries every file for one message, in the order given', () => {
    const second = { ...file, url: 'data:image/webp;base64,BBBB' }
    const [message] = withFileParts(
      toUIMessages([row({ id: 'm1' })]),
      new Map([['m1', [file, second]]]),
    )

    // The order the composer's chips were in, which is also `position` on the
    // rows and the order the answer refers to them by.
    expect(message?.parts.map((part) => (part.type === 'file' ? part.url : 'text'))).toEqual([
      file.url,
      second.url,
      'text',
    ])
  })

  it('is a no-op for an empty map', () => {
    const messages = toUIMessages([row({ id: 'm1' })])

    expect(withFileParts(messages, new Map())[0]).toBe(messages[0])
  })
})
