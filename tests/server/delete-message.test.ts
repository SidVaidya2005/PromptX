import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import { requiredEnv } from '../support/env'
import { describeHosted } from '../support/hosted'

/**
 * Feature 20 deletes a message by primary key — the application's first delete
 * that names a `messages` row directly rather than letting a conversation's
 * cascade take it. What `deleteMessage()` itself contains is three lines of
 * wrapper; what it *relies* on is the owner delete policy and the row-count
 * semantics of `.delete().select()`, and neither of those can be proven against
 * a mock.
 *
 * So this suite exercises the same statement the module issues, through a real
 * signed-in session against the hosted project, exactly as
 * `tests/server/edit-message.test.ts` does for the truncating function. RLS is
 * the isolation boundary; a test that reached it through the service-role client
 * would prove nothing at all, because that client bypasses the thing under test.
 *
 * Fixtures are seeded with the SERVICE-ROLE client, per F03: seeding through the
 * policies being tested would let a broken one leave the table empty, and every
 * "the row survived" assertion would then pass against nothing.
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
  const email = `delete-msg-${label}-${crypto.randomUUID()}@promptx.test`
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
 * One exchange: a prompt and the answer a regeneration would replace.
 *
 * Inserted one at a time rather than as a batch, for the reason the edit suite
 * gives: a batch shares one transaction and therefore one `now()`, and the
 * thread order this feature reads depends on the two rows differing.
 */
async function seedExchange(userId: string) {
  const { data: conversation, error } = await admin
    .from('conversations')
    .insert({
      user_id: userId,
      title: 'Regenerate fixture',
      provider: 'google',
      model_id: 'gemini-3.6-flash',
    })
    .select('id')
    .single()

  if (error) throw error

  const ids: string[] = []

  for (const role of ['user', 'assistant'] as const) {
    const { data, error: insertError } = await admin
      .from('messages')
      .insert({
        conversation_id: conversation.id,
        user_id: userId,
        role,
        content: `${role} 0`,
      })
      .select('id')
      .single()

    if (insertError) throw insertError
    ids.push(data.id)
  }

  const [promptId, answerId] = ids
  if (!promptId || !answerId) throw new Error('fixture did not produce two messages')

  return { conversationId: conversation.id, promptId, answerId }
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

/** The statement `deleteMessage()` issues, through whichever session is given. */
function deleteMessage(client: SupabaseClient<Database>, id: string) {
  return client.from('messages').delete().eq('id', id).select('id').maybeSingle()
}

beforeAll(async () => {
  ;[owner, stranger] = await Promise.all([createActor('owner'), createActor('stranger')])
}, 30_000)

afterAll(async () => {
  // allSettled, not all. These users live on the shared hosted project with no
  // local stack to reset, so under `Promise.all` one rejected delete discards
  // the other's outcome and leaves a real orphan with nothing said about it.
  const results = await Promise.allSettled(
    [owner, stranger]
      .filter((actor): actor is Actor => actor !== undefined)
      .map((actor) => admin.auth.admin.deleteUser(actor.id)),
  )

  for (const result of results) {
    if (result.status === 'rejected') {
      console.error(
        '[tests/delete-message] could not delete a fixture user',
        result.reason,
      )
    }
  }
}, 30_000)

describeHosted('deleting one message by id', () => {
  it('removes the answer and leaves the prompt that produced it', async () => {
    const { conversationId, promptId, answerId } = await seedExchange(owner.id)

    const { data, error } = await deleteMessage(owner.client, answerId)

    expect(error).toBeNull()
    // A row back, not just an absent error. This is what tells a real delete
    // from one RLS filtered out — the two are otherwise indistinguishable.
    expect(data?.id).toBe(answerId)

    const thread = await readThread(conversationId)
    expect(thread.map((row) => row.id)).toEqual([promptId])
  })

  it("cannot delete another user's message, and says nothing about it", async () => {
    const { conversationId, answerId } = await seedExchange(owner.id)

    const { data, error } = await deleteMessage(stranger.client, answerId)

    // Not an error. RLS filters the row out before the delete sees it, so this
    // is indistinguishable from "no such message" — which is correct for both,
    // since confirming an id exists but is not yours is itself a disclosure.
    expect(error).toBeNull()
    expect(data).toBeNull()

    // The half that matters, and the half a "returns null" assertion alone
    // would not catch: the row is still there.
    const thread = await readThread(conversationId)
    expect(thread).toHaveLength(2)
    expect(thread.map((row) => row.id)).toContain(answerId)
  })

  it('reports nothing removed for a message that does not exist', async () => {
    const { data, error } = await deleteMessage(owner.client, crypto.randomUUID())

    expect(error).toBeNull()
    expect(data).toBeNull()
  })

  it('leaves every other conversation alone', async () => {
    const [first, second] = await Promise.all([
      seedExchange(owner.id),
      seedExchange(owner.id),
    ])

    await deleteMessage(owner.client, first.answerId)

    // Same user, written at the same moment. Only the primary key keeps the
    // other exchange out of this — there is no conversation predicate to lean
    // on, which is exactly why the route proves the target is the last message
    // before it gets here.
    expect(await readThread(second.conversationId)).toHaveLength(2)
  })
})
