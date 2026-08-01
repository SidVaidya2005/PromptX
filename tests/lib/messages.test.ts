import { describe, expect, it } from 'vitest'

import { toUIMessages } from '@/lib/messages'

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
        metadata: { status: 'complete', errorMessage: null },
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
      }),
    ])

    expect(message?.metadata).toEqual({
      status: 'error',
      errorMessage: 'Generation stopped',
    })
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
