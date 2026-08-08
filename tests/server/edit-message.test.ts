import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import { requiredEnv } from '../support/env'
import { describeHosted } from '../support/hosted'

/**
 * `edit_message_and_truncate` is the only destructive write in the application,
 * and the only one that can lose someone's conversation. So it is tested the way
 * F03 tests the policies: against the real hosted project, through PostgREST,
 * holding a real signed-in session — not with `set local role`, which proves the
 * predicate while skipping the grants and PostgREST layers in front of it.
 *
 * Fixtures are seeded with the SERVICE-ROLE client. Seeding through the same
 * policies the function relies on would let a broken policy leave the table
 * empty, and every "the right rows survived" assertion would then pass against
 * nothing at all.
 *
 * There is no local stack (F02), so each test builds and tears down its own
 * conversation rather than sharing one — a truncation test that shared fixtures
 * would be deleting the next test's rows.
 */

const SUPABASE_URL = requiredEnv('NEXT_PUBLIC_SUPABASE_URL')
const PUBLISHABLE_KEY = requiredEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY')
const SECRET_KEY = requiredEnv('SUPABASE_SECRET_KEY')

const admin = createClient<Database>(SUPABASE_URL, SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

type Actor = {
  id: string
  client: SupabaseClient<Database>
}

let owner: Actor
let stranger: Actor

async function createActor(label: string): Promise<Actor> {
  const email = `edit-${label}-${crypto.randomUUID()}@promptx.test`
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

  const { error: signInError } = await client.auth.signInWithPassword({
    email,
    password,
  })

  if (signInError) throw new Error(`could not sign in ${label}: ${signInError.message}`)

  return { id: created.user.id, client }
}

/**
 * A conversation with alternating user and assistant messages.
 *
 * Inserted one at a time rather than in a single batch, deliberately: a batch
 * insert shares one transaction and therefore one `now()`, which would give
 * every row the same `created_at` and make the ordering this function truncates
 * by meaningless. Sequential inserts reproduce how the chat route actually
 * writes them.
 */
async function seedThread(userId: string, turns: number) {
  const { data: conversation, error } = await admin
    .from('conversations')
    .insert({
      user_id: userId,
      title: 'Edit fixture',
      provider: 'google',
      model_id: 'gemini-3.6-flash',
    })
    .select('id')
    .single()

  if (error) throw error

  const ids: string[] = []

  for (let turn = 0; turn < turns; turn += 1) {
    for (const role of ['user', 'assistant'] as const) {
      const { data, error: insertError } = await admin
        .from('messages')
        .insert({
          conversation_id: conversation.id,
          user_id: userId,
          role,
          content: `${role} ${turn}`,
        })
        .select('id')
        .single()

      if (insertError) throw insertError
      ids.push(data.id)
    }
  }

  return { conversationId: conversation.id, ids }
}

/**
 * One seeded message id, or a failure that names the index.
 *
 * `noUncheckedIndexedAccess` is on, so a bare `ids[2]` is `string | undefined`.
 * Throwing beats a non-null assertion: if a fixture ever changes shape, this
 * fails with which index was missing rather than passing `undefined` into a SQL
 * function and getting a type error from PostgREST instead.
 */
function idAt(ids: readonly string[], index: number): string {
  const id = ids[index]
  if (!id) throw new Error(`fixture has no message at index ${index}`)
  return id
}

/** The thread as the application reads it — same ordering as listByConversation. */
async function readThread(conversationId: string) {
  const { data, error } = await admin
    .from('messages')
    .select('id, role, content')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })

  if (error) throw error
  return data
}

beforeAll(async () => {
  ;[owner, stranger] = await Promise.all([createActor('owner'), createActor('stranger')])
}, 30_000)

afterAll(async () => {
  // allSettled, not all. These users live on the shared hosted project — there
  // is no local stack to reset — so under `Promise.all` one rejected delete
  // discards the other's outcome and leaves a real orphan behind with nothing
  // said about it. Observed once, from a transient network fault mid-run.
  const results = await Promise.allSettled(
    [owner, stranger]
      .filter((actor): actor is Actor => actor !== undefined)
      .map((actor) => admin.auth.admin.deleteUser(actor.id)),
  )

  for (const result of results) {
    if (result.status === 'rejected') {
      console.error('[tests/edit-message] could not delete a fixture user', result.reason)
    }
  }
}, 30_000)

describeHosted('edit_message_and_truncate', () => {
  it('rewrites a mid-thread prompt and deletes only what came after it', async () => {
    // user0 assistant0 user1 assistant1 user2 assistant2
    const { conversationId, ids } = await seedThread(owner.id, 3)
    const target = idAt(ids, 2) // user1

    const { data: removed, error } = await owner.client.rpc('edit_message_and_truncate', {
      p_message_id: target,
      p_content: 'rewritten',
    })

    expect(error).toBeNull()
    // assistant1, user2, assistant2 — everything strictly after the target.
    expect(removed).toBe(3)

    const thread = await readThread(conversationId)

    expect(thread.map((row) => row.content)).toEqual([
      'user 0',
      'assistant 0',
      'rewritten',
    ])
    // The row is edited in place, never replaced. Its id is what the outline
    // rail anchors to and what a deep link would point at.
    expect(thread[2]?.id).toBe(target)
  })

  it('leaves everything before the edited message untouched', async () => {
    const { conversationId, ids } = await seedThread(owner.id, 3)
    const before = await readThread(conversationId)

    await owner.client.rpc('edit_message_and_truncate', {
      p_message_id: idAt(ids, 4), // user2
      p_content: 'rewritten',
    })

    const after = await readThread(conversationId)

    expect(after.slice(0, 4)).toEqual(before.slice(0, 4))
  })

  it('preserves the edited row’s created_at, so it keeps its place', async () => {
    const { ids } = await seedThread(owner.id, 2)
    const target = idAt(ids, 0)

    const { data: before } = await admin
      .from('messages')
      .select('created_at')
      .eq('id', target)
      .single()

    await owner.client.rpc('edit_message_and_truncate', {
      p_message_id: target,
      p_content: 'rewritten',
    })

    const { data: after } = await admin
      .from('messages')
      .select('created_at')
      .eq('id', target)
      .single()

    expect(after?.created_at).toBe(before?.created_at)
  })

  it('removes nothing when the edited message is already the last one', async () => {
    const { conversationId, ids } = await seedThread(owner.id, 1)

    // Drop the assistant reply so the user message is genuinely last — the state
    // someone is in when they fix a typo before the answer lands.
    await admin.from('messages').delete().eq('id', idAt(ids, 1))

    const { data: removed, error } = await owner.client.rpc('edit_message_and_truncate', {
      p_message_id: idAt(ids, 0),
      p_content: 'rewritten',
    })

    expect(error).toBeNull()
    expect(removed).toBe(0)

    const thread = await readThread(conversationId)
    expect(thread).toHaveLength(1)
    expect(thread[0]?.content).toBe('rewritten')
  })

  it('refuses an assistant message, and deletes nothing when it does', async () => {
    const { conversationId, ids } = await seedThread(owner.id, 2)

    const { data: removed, error } = await owner.client.rpc(
      'edit_message_and_truncate',
      { p_message_id: idAt(ids, 1), p_content: 'forged' }, // assistant 0
    )

    expect(error).toBeNull()
    // Null, not zero. Zero would mean "edited it, removed nothing".
    expect(removed).toBeNull()

    const thread = await readThread(conversationId)
    expect(thread).toHaveLength(4)
    expect(thread[1]?.content).toBe('assistant 0')
  })

  it("cannot touch another user's message, and says nothing about it", async () => {
    const { conversationId, ids } = await seedThread(owner.id, 2)

    const { data: removed, error } = await stranger.client.rpc(
      'edit_message_and_truncate',
      { p_message_id: idAt(ids, 0), p_content: 'stolen' },
    )

    // Not an error — RLS filters the row out before the update sees it, so the
    // function genuinely cannot distinguish "not yours" from "does not exist".
    // Confirming that an id exists but belongs to someone else is a disclosure.
    expect(error).toBeNull()
    expect(removed).toBeNull()

    const thread = await readThread(conversationId)
    expect(thread).toHaveLength(4)
    expect(thread[0]?.content).toBe('user 0')
  })

  /**
   * The case `created_at` alone cannot decide.
   *
   * Sequential inserts never produce a tie — separate PostgREST calls mean
   * separate transactions and different `now()` — so it has to be constructed,
   * which is exactly why it would otherwise go untested until it happened to
   * somebody's real conversation.
   *
   * The ids are fixed rather than generated, and that matters. `(created_at,
   * id)` breaks a tie by uuid, and a random uuid sorts either way — a fixture
   * that let the ids fall where they may would pass about half the time and
   * read as flaky rather than as a real result. Pinning them makes both
   * directions their own deterministic assertion.
   *
   * What the ordering actually promises is not "the answer is always deleted".
   * It is that **truncation and display agree**: whatever sorts after the
   * edited message is removed, and whatever sorts before it survives — so the
   * thread can never show a reply beneath a prompt that no longer produced it.
   */
  async function seedTie(promptId: string, answerId: string) {
    const { data: conversation, error: conversationError } = await admin
      .from('conversations')
      .insert({
        user_id: owner.id,
        title: 'Tie fixture',
        provider: 'google',
        model_id: 'gemini-3.6-flash',
      })
      .select('id')
      .single()

    if (conversationError) throw conversationError

    const sharedTimestamp = new Date().toISOString()

    const { error: insertError } = await admin.from('messages').insert([
      {
        id: promptId,
        conversation_id: conversation.id,
        user_id: owner.id,
        role: 'user',
        content: 'tied prompt',
        created_at: sharedTimestamp,
      },
      {
        id: answerId,
        conversation_id: conversation.id,
        user_id: owner.id,
        role: 'assistant',
        content: 'tied answer',
        created_at: sharedTimestamp,
      },
    ])

    if (insertError) throw insertError

    return conversation.id
  }

  // Four distinct ids, not two pairs of the same two. The edited row survives
  // its test, so reusing an id in the second one collides on messages_pkey —
  // which is how the first draft of these two failed.
  const AFTER_PROMPT = '00000000-0000-4000-8000-000000000001'
  const AFTER_ANSWER = '00000000-0000-4000-8000-000000000002'
  const BEFORE_ANSWER = '00000000-0000-4000-8000-000000000003'
  const BEFORE_PROMPT = '00000000-0000-4000-8000-000000000004'

  it('removes a tied answer that sorts after the prompt', async () => {
    const conversationId = await seedTie(AFTER_PROMPT, AFTER_ANSWER)

    const { data: removed } = await owner.client.rpc('edit_message_and_truncate', {
      p_message_id: AFTER_PROMPT,
      p_content: 'rewritten',
    })

    // Under a bare `created_at >` predicate this is 0, and the thread is left
    // showing a rewritten prompt followed by the reply to the old one.
    expect(removed).toBe(1)
    expect((await readThread(conversationId)).map((row) => row.content)).toEqual([
      'rewritten',
    ])
  })

  it('keeps a tied answer that sorts before the prompt, and still reads in order', async () => {
    const conversationId = await seedTie(BEFORE_PROMPT, BEFORE_ANSWER)

    const { data: removed } = await owner.client.rpc('edit_message_and_truncate', {
      p_message_id: BEFORE_PROMPT,
      p_content: 'rewritten',
    })

    // Surviving is correct here rather than a miss: this row sorts *before* the
    // edited prompt, so it is displayed before it too. Truncation and display
    // agree, which is the whole guarantee — the thread never shows a reply
    // beneath a prompt that did not produce it.
    expect(removed).toBe(0)
    expect((await readThread(conversationId)).map((row) => row.content)).toEqual([
      'tied answer',
      'rewritten',
    ])
  })

  it('returns null for a message that does not exist', async () => {
    const { data: removed, error } = await owner.client.rpc('edit_message_and_truncate', {
      p_message_id: crypto.randomUUID(),
      p_content: 'nothing',
    })

    expect(error).toBeNull()
    expect(removed).toBeNull()
  })

  it('only truncates inside its own conversation', async () => {
    const [first, second] = await Promise.all([
      seedThread(owner.id, 2),
      seedThread(owner.id, 2),
    ])

    await owner.client.rpc('edit_message_and_truncate', {
      p_message_id: idAt(first.ids, 0),
      p_content: 'rewritten',
    })

    // The other conversation is the same user's and was written at the same
    // moment; only the conversation_id predicate keeps it out of the delete.
    expect(await readThread(second.conversationId)).toHaveLength(4)
  })
})
