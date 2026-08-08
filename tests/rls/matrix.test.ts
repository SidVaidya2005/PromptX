import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import { requiredEnv } from '../support/env'
import { describeHosted } from '../support/hosted'

/**
 * Every table, every verb it holds a policy for, from a second user's session.
 *
 * `isolation.test.ts` proves the cases that need their own narrative — the share
 * link visible to `anon` and invisible to `authenticated`, attachment metadata,
 * the storage prefix. This file is the grid underneath it: for each table, can a
 * stranger read, insert, change, or delete a row that is not theirs. The overlap
 * with that file is deliberate. RLS is the isolation boundary for this whole
 * application, and a duplicated assertion in a security suite costs a second and
 * buys a second chance of noticing.
 *
 * Three things make the grid worth more than the sum of its cells:
 *
 * - **a write RLS filters out is indistinguishable from a successful no-op.** It
 *   reports no error and no rows. So every update and delete below asserts on
 *   the returned row count, never on the absence of an error.
 * - **the deliberate absences are asserted too.** `profiles` has no insert and
 *   no delete policy, and `shared_key_usage` has no delete policy — so the OWNER
 *   is refused as well. Those are narrowings someone will eventually try to
 *   "restore consistency" on, and a test is what tells them why not.
 * - **`shared_key_budget` carries no policy for any role**, which makes it
 *   unreachable through the publishable key by construction rather than by rule.
 *
 * `tests/rls/policy-census.test.ts` is the other half: it fails when a policy
 * exists that this grid does not cover, which no behavioural test can notice.
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

/** Set up once, so each table's fixtures are addressable by every test below. */
let ownerConversationId: string
let ownerMessageId: string
let ownerPromptId: string
let ownerAttachmentId: string
let ownerProviderKeyId: string

async function createActor(label: string): Promise<Actor> {
  const email = `matrix-${label}-${crypto.randomUUID()}@promptx.test`
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

beforeAll(async () => {
  ;[owner, stranger] = await Promise.all([createActor('owner'), createActor('stranger')])

  const { data: conversation, error: conversationError } = await admin
    .from('conversations')
    .insert({
      user_id: owner.id,
      title: 'Matrix fixture',
      provider: 'google',
      model_id: 'gemini-3.6-flash',
    })
    .select('id')
    .single()
  if (conversationError) throw conversationError
  ownerConversationId = conversation.id

  const { data: message, error: messageError } = await admin
    .from('messages')
    .insert({
      conversation_id: ownerConversationId,
      user_id: owner.id,
      role: 'user',
      content: 'a private question',
    })
    .select('id')
    .single()
  if (messageError) throw messageError
  ownerMessageId = message.id

  const { data: prompt, error: promptError } = await admin
    .from('prompts')
    .insert({ user_id: owner.id, title: 'Private prompt', body: 'secret body', tags: [] })
    .select('id')
    .single()
  if (promptError) throw promptError
  ownerPromptId = prompt.id

  const { data: attachment, error: attachmentError } = await admin
    .from('attachments')
    .insert({
      user_id: owner.id,
      message_id: ownerMessageId,
      position: 0,
      storage_path: `${owner.id}/${crypto.randomUUID()}.png`,
      mime_type: 'image/png',
      size_bytes: 128,
      status: 'ready',
    })
    .select('id')
    .single()
  if (attachmentError) throw attachmentError
  ownerAttachmentId = attachment.id

  const { data: providerKey, error: providerKeyError } = await admin
    .from('provider_keys')
    .insert({
      user_id: owner.id,
      provider: 'openai',
      ciphertext: '\\xdeadbeef',
      iv: '\\xdeadbeefdeadbeefdeadbeef',
      auth_tag: '\\xdeadbeefdeadbeefdeadbeefdeadbeef',
      last_four: 'abcd',
    })
    .select('id')
    .single()
  if (providerKeyError) throw providerKeyError
  ownerProviderKeyId = providerKey.id

  const { error: usageError } = await admin.from('shared_key_usage').insert({
    user_id: owner.id,
    usage_date: new Date().toISOString().slice(0, 10),
    message_count: 4,
  })
  if (usageError) throw usageError
}, 60_000)

afterAll(async () => {
  const results = await Promise.allSettled(
    [owner, stranger]
      .filter((actor): actor is Actor => actor !== undefined)
      .map((actor) => admin.auth.admin.deleteUser(actor.id)),
  )

  for (const result of results) {
    if (result.status === 'rejected') {
      console.error('[tests/rls-matrix] could not delete a fixture user', result.reason)
    }
  }
}, 30_000)

/**
 * The four questions asked of every `id`-keyed table.
 *
 * Written as one helper rather than repeated per table so a new table is one
 * entry rather than forty lines — and so no table quietly ends up with three of
 * the four checks.
 */
type IdKeyedCase = {
  table: 'provider_keys' | 'conversations' | 'messages' | 'prompts' | 'attachments'
  rowId: () => string
  /** A row owned by the OWNER, which the stranger will try to insert. */
  forgedRow: () => Record<string, unknown>
  /** A change the stranger will try to make to the owner's row. */
  patch: Record<string, unknown>
}

const ID_KEYED: IdKeyedCase[] = [
  {
    table: 'provider_keys',
    rowId: () => ownerProviderKeyId,
    forgedRow: () => ({
      user_id: owner.id,
      provider: 'anthropic',
      ciphertext: '\\xdeadbeef',
      iv: '\\xdeadbeefdeadbeefdeadbeef',
      auth_tag: '\\xdeadbeefdeadbeefdeadbeefdeadbeef',
      last_four: 'ffff',
    }),
    patch: { last_four: 'hack' },
  },
  {
    table: 'conversations',
    rowId: () => ownerConversationId,
    forgedRow: () => ({
      user_id: owner.id,
      title: 'planted',
      provider: 'google',
      model_id: 'gemini-3.6-flash',
    }),
    patch: { title: 'renamed by a stranger' },
  },
  {
    table: 'messages',
    rowId: () => ownerMessageId,
    forgedRow: () => ({
      conversation_id: ownerConversationId,
      user_id: owner.id,
      role: 'user',
      content: 'planted',
    }),
    patch: { content: 'rewritten by a stranger' },
  },
  {
    table: 'prompts',
    rowId: () => ownerPromptId,
    forgedRow: () => ({ user_id: owner.id, title: 'planted', body: 'planted', tags: [] }),
    patch: { title: 'rewritten by a stranger' },
  },
  {
    table: 'attachments',
    rowId: () => ownerAttachmentId,
    forgedRow: () => ({
      user_id: owner.id,
      message_id: ownerMessageId,
      position: 3,
      storage_path: `${owner.id}/planted.png`,
      mime_type: 'image/png',
      size_bytes: 1,
      status: 'ready',
    }),
    patch: { status: 'pending' },
  },
]

for (const testCase of ID_KEYED) {
  describeHosted(`${testCase.table} — a stranger's session`, () => {
    it('cannot read the row', async () => {
      const { data, error } = await stranger.client
        .from(testCase.table)
        .select('id')
        .eq('id', testCase.rowId())

      expect(error).toBeNull()
      expect(data).toEqual([])
    })

    it('cannot insert a row owned by somebody else', async () => {
      // The with-check half. Without it a stranger could plant rows into another
      // user's account — visible to them, attributed to them, and on their bill
      // if it reaches a quota.
      const { error } = await stranger.client
        .from(testCase.table)
        .insert(testCase.forgedRow() as never)

      expect(error).not.toBeNull()
    })

    it('cannot change the row, checked on the row rather than on the reply', async () => {
      // **This cell cannot isolate the UPDATE policy, and saying so is the
      // point.** Measured at F35 by weakening `owner updates` on `prompts` to
      // `using (true)`: the suite stayed entirely green, because Postgres
      // applies SELECT policies to an UPDATE that carries a WHERE clause — so
      // the stranger's statement never selected a row to write to. Weakening
      // BOTH turned exactly two tests red, this one among them, with the title
      // genuinely rewritten.
      //
      // That is real defence in depth rather than a gap, and it is the same
      // shape F26 recorded for `search_messages`: either policy alone is
      // sufficient, so no test here can tell you which one is doing the work.
      // Anyone weakening one of these and finding the suite green should
      // conclude that the OTHER one is holding, not that the test is broken.
      //
      // The check reads the row back through the service-role client rather
      // than trusting the reply, per F19: an empty reply proves only that the
      // SELECT policy filtered `RETURNING`, which is a different question from
      // whether the write landed.
      const [field, forbiddenValue] = Object.entries(testCase.patch)[0] ?? []
      if (!field) throw new Error('every case needs a patch to attempt')

      const { error } = await stranger.client
        .from(testCase.table)
        .update(testCase.patch as never)
        .eq('id', testCase.rowId())
        .select('id')

      expect(error).toBeNull()

      const { data: after } = await admin
        .from(testCase.table)
        .select(field)
        .eq('id', testCase.rowId())
        .maybeSingle()

      expect((after as Record<string, unknown> | null)?.[field]).not.toBe(forbiddenValue)
    })

    it('cannot delete the row', async () => {
      const { data, error } = await stranger.client
        .from(testCase.table)
        .delete()
        .eq('id', testCase.rowId())
        .select('id')

      expect(error).toBeNull()
      expect(data).toEqual([])
    })

    it('leaves the row intact after all of that', async () => {
      // The assertions above say the stranger saw nothing. This one says the
      // row is still there — the difference between "denied" and "denied after
      // the damage was done".
      const { data } = await admin
        .from(testCase.table)
        .select('id')
        .eq('id', testCase.rowId())
        .maybeSingle()

      expect(data?.id).toBe(testCase.rowId())
    })
  })
}

describeHosted('profiles — the two deliberate absences', () => {
  it('shows a stranger their own profile and nobody else’s', async () => {
    const { data } = await stranger.client.from('profiles').select('id')

    expect(data?.map((row) => row.id)).toEqual([stranger.id])
  })

  it('refuses a stranger’s update of another profile', async () => {
    await stranger.client
      .from('profiles')
      .update({ display_name: 'renamed by a stranger' })
      .eq('id', owner.id)
      .select('id')

    // Read back through the service-role client, not from the reply: an empty
    // reply only proves the SELECT policy filtered it. See the id-keyed case
    // above for the mutation that made this necessary.
    const { data: after } = await admin
      .from('profiles')
      .select('display_name')
      .eq('id', owner.id)
      .maybeSingle()

    expect(after?.display_name).not.toBe('renamed by a stranger')
  })

  it('refuses an insert even from the owner, because the trigger creates the row', async () => {
    // No insert policy exists, on purpose: `handle_new_user()` writes this row
    // as the auth admin. Adding one would let a client create profiles the
    // trigger never saw.
    const { error } = await owner.client
      .from('profiles')
      .insert({ id: crypto.randomUUID(), email: 'planted@promptx.test' })

    expect(error).not.toBeNull()
  })

  it('refuses a delete even from the owner, because it would orphan the user', async () => {
    // Deleting the profile leaves a surviving auth.users row that will never
    // fire the trigger again — an account with no profile and no way back.
    const { data, error } = await owner.client
      .from('profiles')
      .delete()
      .eq('id', owner.id)
      .select('id')

    expect(error).toBeNull()
    expect(data).toEqual([])

    const { data: still } = await admin
      .from('profiles')
      .select('id')
      .eq('id', owner.id)
      .maybeSingle()
    expect(still?.id).toBe(owner.id)
  })
})

describeHosted('shared_key_usage — an allowance nobody else can touch', () => {
  it('hides another user’s allowance', async () => {
    const { data } = await stranger.client
      .from('shared_key_usage')
      .select('message_count')
      .eq('user_id', owner.id)

    expect(data).toEqual([])
  })

  it('refuses a forged row against somebody else’s allowance', async () => {
    const { error } = await stranger.client.from('shared_key_usage').insert({
      user_id: owner.id,
      usage_date: new Date().toISOString().slice(0, 10),
      message_count: 0,
    })

    expect(error).not.toBeNull()
  })

  it('refuses a stranger lowering somebody else’s count', async () => {
    // The one with money behind it: a stranger who could zero this row would
    // hand somebody an unlimited shared-key allowance. Read back through the
    // service-role client for the reason the id-keyed update case records.
    await stranger.client
      .from('shared_key_usage')
      .update({ message_count: 0 })
      .eq('user_id', owner.id)
      .select('user_id')

    const { data: after } = await admin
      .from('shared_key_usage')
      .select('message_count')
      .eq('user_id', owner.id)
      .maybeSingle()

    expect(after?.message_count).toBe(4)
  })

  it('refuses a delete even from the owner, which is how the cap survives', async () => {
    // There is no delete policy, and that absence IS the enforcement: dropping
    // the row is precisely how somebody would reset their own daily allowance.
    const today = new Date().toISOString().slice(0, 10)

    const { data, error } = await owner.client
      .from('shared_key_usage')
      .delete()
      .eq('user_id', owner.id)
      .eq('usage_date', today)
      .select('user_id')

    expect(error).toBeNull()
    expect(data).toEqual([])

    const { data: still } = await admin
      .from('shared_key_usage')
      .select('message_count')
      .eq('user_id', owner.id)
      .eq('usage_date', today)
      .maybeSingle()

    expect(still?.message_count).toBe(4)
  })
})

describeHosted('shared_key_budget — reachable by no policy at all', () => {
  it('is invisible to a signed-in user', async () => {
    const { data, error } = await owner.client.from('shared_key_budget').select('*')

    // RLS enabled with no policy: the read succeeds and returns nothing, which
    // is what "unreachable by construction" looks like from the outside.
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('cannot be written by a signed-in user', async () => {
    // The attempted write is deliberately a no-op — the row's own current value
    // written back — because this is the live ledger the running application
    // reads, and there is no local stack to isolate against. If a policy were
    // ever added here the reply would carry the row and this goes red, without
    // a run of the test suite being able to trip the shared key for real. (F17)
    const { data: before } = await admin
      .from('shared_key_budget')
      .select('input_tokens')
      .eq('id', 1)
      .single()

    const { data, error } = await owner.client
      .from('shared_key_budget')
      .update({ input_tokens: before?.input_tokens ?? 0 })
      .eq('id', 1)
      .select('id')

    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('is invisible to an anonymous visitor', async () => {
    const anon = createClient<Database>(SUPABASE_URL, PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { data } = await anon.from('shared_key_budget').select('*')

    expect(data).toEqual([])
  })
})
