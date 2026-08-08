import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'

import {
  appendMessage,
  completeMessage,
  editMessageAndTruncate,
  failMessage,
  getMessage,
  listByConversation,
} from '@/server/data/messages'

import type { Database } from '@/types/database'

import { requiredEnv } from '../support/env'
import { describeHosted } from '../support/hosted'

/**
 * The row a stream lives inside, from insert to completion or failure.
 *
 * `edit-message.test.ts`, `delete-message.test.ts` and `search-messages.test.ts`
 * cover the destructive and the searching halves. What had never been called is
 * the ordinary path: append a prompt, open an assistant row in `streaming`, and
 * close it one way or the other.
 *
 * Two properties are worth more than they look:
 *
 * - **an unreported token count is stored as null, never as a guess.** F17's
 *   circuit breaker is fed by measured usage only; a fabricated number does not
 *   make the ledger more accurate, it makes the breaker trip for everyone on
 *   invented data.
 * - **a failed generation is updated, never deleted.** A response that broke
 *   halfway is still something the person watched appear, and a thread where it
 *   silently vanishes is harder to make sense of than one that says so.
 *
 * The thread order is `(created_at, id)` in both `listByConversation` and
 * `edit_message_and_truncate`, and the two must stay in step — `created_at`
 * alone is not total, and "every message after this one" needs an exact meaning
 * before anything deletes by it. (F19)
 */

const SUPABASE_URL = requiredEnv('NEXT_PUBLIC_SUPABASE_URL')
const PUBLISHABLE_KEY = requiredEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY')
const SECRET_KEY = requiredEnv('SUPABASE_SECRET_KEY')

const admin = createClient<Database>(SUPABASE_URL, SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

type Actor = { id: string; client: SupabaseClient<Database> }

let owner: Actor
let stranger: Actor
let sessionClient: SupabaseClient<Database>
let conversationId: string

vi.mock('@/server/supabase', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/supabase')>()),
  createServerSupabaseClient: async () => sessionClient,
}))

async function createActor(label: string): Promise<Actor> {
  const email = `msg-life-${label}-${crypto.randomUUID()}@promptx.test`
  const password = crypto.randomUUID()

  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })

  if (error || !created.user) {
    throw new Error(`could not create ${label}: ${error?.message}`)
  }

  const client = createClient<Database>(SUPABASE_URL, PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { error: signInError } = await client.auth.signInWithPassword({ email, password })
  if (signInError) throw new Error(`could not sign in ${label}: ${signInError.message}`)

  return { id: created.user.id, client }
}

async function seedConversation(userId: string): Promise<string> {
  const { data, error } = await admin
    .from('conversations')
    .insert({
      user_id: userId,
      title: 'Message fixture',
      provider: 'google',
      model_id: 'gemini-3.6-flash',
    })
    .select('id')
    .single()

  if (error) throw error
  return data.id
}

async function readMessage(id: string) {
  const { data, error } = await admin
    .from('messages')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) throw error
  return data
}

beforeAll(async () => {
  ;[owner, stranger] = await Promise.all([createActor('owner'), createActor('stranger')])
}, 30_000)

beforeEach(async () => {
  sessionClient = owner.client
  conversationId = await seedConversation(owner.id)
})

afterAll(async () => {
  const results = await Promise.allSettled(
    [owner, stranger]
      .filter((actor): actor is Actor => actor !== undefined)
      .map((actor) => admin.auth.admin.deleteUser(actor.id)),
  )

  for (const result of results) {
    if (result.status === 'rejected') {
      console.error('[tests/message-lifecycle] could not delete a fixture user', result.reason)
    }
  }
}, 30_000)

describeHosted('appendMessage', () => {
  it('returns the id the stream will hold for its lifetime', async () => {
    // The id rather than the row, because F08 keeps it open across the whole
    // generation: completion and failure are then a targeted update by primary
    // key rather than "the most recent message", which at failure time would be
    // the user's own prompt.
    const id = await appendMessage({
      conversationId,
      userId: owner.id,
      role: 'user',
      content: 'What does the reaper do?',
    })

    expect(await readMessage(id)).toMatchObject({
      role: 'user',
      content: 'What does the reaper do?',
      status: 'complete',
    })
  })

  it('defaults a user message to no provider, no model and no shared-key claim', async () => {
    const id = await appendMessage({
      conversationId,
      userId: owner.id,
      role: 'user',
      content: 'hello',
    })

    const row = await readMessage(id)
    expect(row?.provider).toBeNull()
    expect(row?.model_id).toBeNull()
    expect(row?.used_shared_key).toBe(false)
  })

  it('opens an assistant row in streaming, which is what failure needs to target', async () => {
    const id = await appendMessage({
      conversationId,
      userId: owner.id,
      role: 'assistant',
      content: '',
      provider: 'google',
      modelId: 'gemini-3.6-flash',
      usedSharedKey: true,
      status: 'streaming',
    })

    expect(await readMessage(id)).toMatchObject({
      status: 'streaming',
      content: '',
      used_shared_key: true,
      model_id: 'gemini-3.6-flash',
    })
  })

  it('cannot write a message into another user’s conversation', async () => {
    const theirs = await seedConversation(stranger.id)

    await expect(
      appendMessage({
        conversationId: theirs,
        userId: stranger.id,
        role: 'user',
        content: 'not mine to write',
      }),
    ).rejects.toThrow()
  })
})

describeHosted('completeMessage', () => {
  it('closes the row it was given and records the measured tokens', async () => {
    const id = await appendMessage({
      conversationId,
      userId: owner.id,
      role: 'assistant',
      content: '',
      status: 'streaming',
    })

    await completeMessage(id, {
      content: 'Objects first, then rows.',
      inputTokens: 412,
      outputTokens: 77,
    })

    expect(await readMessage(id)).toMatchObject({
      status: 'complete',
      content: 'Objects first, then rows.',
      input_tokens: 412,
      output_tokens: 77,
    })
  })

  it('stores null rather than a guess when the provider reported no usage', async () => {
    // The ledger that drives the circuit breaker takes measured tokens only. A
    // fabricated number does not make it more accurate — it trips the breaker
    // for everyone on spend that may not have happened.
    const id = await appendMessage({
      conversationId,
      userId: owner.id,
      role: 'assistant',
      content: '',
      status: 'streaming',
    })

    await completeMessage(id, { content: 'done' })

    const row = await readMessage(id)
    expect(row?.input_tokens).toBeNull()
    expect(row?.output_tokens).toBeNull()
    expect(row?.status).toBe('complete')
  })

  it('touches only the row named, never the newest one', async () => {
    // At the moment a stream ends the newest row may not be the one that was
    // streaming — a second turn can have started.
    const target = await appendMessage({
      conversationId,
      userId: owner.id,
      role: 'assistant',
      content: '',
      status: 'streaming',
    })
    const later = await appendMessage({
      conversationId,
      userId: owner.id,
      role: 'user',
      content: 'a follow-up',
    })

    await completeMessage(target, { content: 'the answer' })

    expect((await readMessage(target))?.content).toBe('the answer')
    expect((await readMessage(later))?.content).toBe('a follow-up')
  })
})

describeHosted('failMessage', () => {
  it('keeps whatever arrived and says what happened', async () => {
    // Updated, never deleted. A response that broke halfway is still something
    // the person watched appear.
    const id = await appendMessage({
      conversationId,
      userId: owner.id,
      role: 'assistant',
      content: '',
      status: 'streaming',
    })

    await failMessage(id, {
      content: 'Objects first, then',
      errorMessage: 'Generation was interrupted',
    })

    expect(await readMessage(id)).toMatchObject({
      status: 'error',
      content: 'Objects first, then',
      error_message: 'Generation was interrupted',
    })
  })

  it('leaves the row in the thread rather than removing it', async () => {
    const id = await appendMessage({
      conversationId,
      userId: owner.id,
      role: 'assistant',
      content: '',
      status: 'streaming',
    })

    await failMessage(id, { content: 'partial', errorMessage: 'boom' })

    expect(await readMessage(id)).not.toBeNull()
  })
})

describeHosted('editMessageAndTruncate', () => {
  it('rewrites the prompt, removes what came after it, and reports the count', async () => {
    // The SQL function has its own suite. What is exercised here is the wrapper
    // nothing had ever called — the argument names it passes and the null it
    // maps. F13 is why that matters: `bytea` corruption lived in exactly this
    // layer, reported success, and only surfaced when something tried to
    // decrypt.
    const promptId = await appendMessage({
      conversationId,
      userId: owner.id,
      role: 'user',
      content: 'original question',
    })
    await appendMessage({
      conversationId,
      userId: owner.id,
      role: 'assistant',
      content: 'answer to the original',
    })

    const removed = await editMessageAndTruncate(promptId, 'a better question')

    expect(removed).toBe(1)
    expect((await listByConversation(conversationId)).map((m) => m.content)).toEqual([
      'a better question',
    ])
  })

  it('returns null rather than throwing for a message that is not the caller’s', async () => {
    // Missing, not owned, and not a user message must stay indistinguishable —
    // the function returns null for all three, and the route turns that into a
    // 404 without disclosing which it was.
    const theirs = await seedConversation(stranger.id)
    const { data } = await admin
      .from('messages')
      .insert({
        conversation_id: theirs,
        user_id: stranger.id,
        role: 'user',
        content: 'not yours',
      })
      .select('id')
      .single()

    expect(await editMessageAndTruncate(data?.id ?? '', 'hijacked')).toBeNull()

    const { data: after } = await admin
      .from('messages')
      .select('content')
      .eq('id', data?.id ?? '')
      .maybeSingle()
    expect(after?.content).toBe('not yours')
  })
})

describeHosted('getMessage', () => {
  it('returns the caller’s own message', async () => {
    const id = await appendMessage({
      conversationId,
      userId: owner.id,
      role: 'user',
      content: 'mine',
    })

    expect((await getMessage(id))?.content).toBe('mine')
  })

  it('returns null for a message that is not the caller’s', async () => {
    const theirs = await seedConversation(stranger.id)
    const { data } = await admin
      .from('messages')
      .insert({
        conversation_id: theirs,
        user_id: stranger.id,
        role: 'user',
        content: 'theirs',
      })
      .select('id')
      .single()

    expect(await getMessage(data?.id ?? '')).toBeNull()
  })
})

describeHosted('listByConversation', () => {
  it('reads the thread in order', async () => {
    for (const [role, content] of [
      ['user', 'first'],
      ['assistant', 'second'],
      ['user', 'third'],
    ] as const) {
      // One at a time: a batch shares a transaction and therefore one now(),
      // and the order under test depends on the rows differing.
      await appendMessage({ conversationId, userId: owner.id, role, content })
    }

    expect((await listByConversation(conversationId)).map((m) => m.content)).toEqual([
      'first',
      'second',
      'third',
    ])
  })

  it('breaks a timestamp tie by id, so the order is total', async () => {
    // `created_at` alone is not total, and truncation deletes by "everything
    // after this one". Display and truncation must agree by construction, or a
    // reply can survive beneath a prompt that no longer produced it. (F19)
    const stamp = new Date().toISOString()

    // Two ids sharing a random prefix and differing only in the final nibble.
    // The tiebreak is therefore deterministic — `first` sorts below `second`
    // every run — without the ids being CONSTANT, which is what broke this:
    // `edit-message.test.ts` pins the same two literals for F19's own tie test,
    // Vitest runs files in parallel, and whichever inserted second collided on
    // the primary key. The failure read as an ordering bug because the insert's
    // error was not checked; it is now.
    const base = crypto.randomUUID().slice(0, -1)
    const first = `${base}1`
    const second = `${base}2`

    const { error: seedError } = await admin.from('messages').insert([
      {
        id: second,
        conversation_id: conversationId,
        user_id: owner.id,
        role: 'assistant',
        content: 'tied second',
        created_at: stamp,
      },
      {
        id: first,
        conversation_id: conversationId,
        user_id: owner.id,
        role: 'user',
        content: 'tied first',
        created_at: stamp,
      },
    ])

    // A seed that fails silently turns every assertion below into a statement
    // about an empty table.
    if (seedError) throw seedError

    const thread = await listByConversation(conversationId)

    expect(thread.map((m) => m.content)).toEqual(['tied first', 'tied second'])
  })

  it('returns nothing for a conversation the caller does not own', async () => {
    const theirs = await seedConversation(stranger.id)
    await admin
      .from('messages')
      .insert({ conversation_id: theirs, user_id: stranger.id, role: 'user', content: 'hidden' })

    expect(await listByConversation(theirs)).toEqual([])
  })
})
