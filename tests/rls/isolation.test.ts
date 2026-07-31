import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import { requiredEnv } from '../support/env'

/**
 * Row-Level Security is the isolation boundary in this project, not application
 * code. That claim is only worth anything if something has attacked it, so this
 * suite does exactly what an attacker with a stolen session would: sign in as
 * one real user and go after another real user's rows directly, over HTTP,
 * through PostgREST, holding nothing but the publishable key and a valid JWT.
 *
 * Two deliberate choices about how it is built:
 *
 * - Fixtures are seeded with the SERVICE-ROLE client, which bypasses RLS. If
 *   seeding went through the policies under test, a broken insert policy would
 *   leave the table empty and every subsequent "cannot see B's row" assertion
 *   would pass for entirely the wrong reason.
 * - Assertions run through a client built from the PUBLISHABLE key carrying a
 *   real signed-in session. `set local role` in SQL would prove the policy
 *   predicate while skipping the GRANT and PostgREST layers that sit in front
 *   of it in production.
 */

const SUPABASE_URL = requiredEnv('NEXT_PUBLIC_SUPABASE_URL')
const PUBLISHABLE_KEY = requiredEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY')
const SECRET_KEY = requiredEnv('SUPABASE_SECRET_KEY')

type Actor = {
  id: string
  email: string
  password: string
  /** Publishable key + this user's session. What the browser would hold. */
  client: SupabaseClient<Database>
  conversationId: string
  messageId: string
  promptId: string
  providerKeyId: string
}

const admin = createClient<Database>(SUPABASE_URL, SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

/** No session attached — this is what a stranger with the public key holds. */
const stranger = createClient<Database>(SUPABASE_URL, PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

let alice: Actor
let bob: Actor

async function createActor(label: string): Promise<Actor> {
  // Randomised so two runs in flight cannot collide on the unique email index.
  const email = `rls-${label}-${crypto.randomUUID()}@promptx.test`
  const password = crypto.randomUUID()

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })

  if (createError || !created.user) {
    throw new Error(`could not create ${label}: ${createError?.message}`)
  }

  const userId = created.user.id

  const client = createClient<Database>(SUPABASE_URL, PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { error: signInError } = await client.auth.signInWithPassword({
    email,
    password,
  })

  if (signInError) {
    throw new Error(`could not sign in ${label}: ${signInError.message}`)
  }

  // Seeded as service role, on purpose — see the note at the top of this file.
  const { data: conversation, error: conversationError } = await admin
    .from('conversations')
    .insert({
      user_id: userId,
      title: `${label}'s private conversation`,
      provider: 'google',
      model_id: 'gemini-2.5-flash',
    })
    .select('id')
    .single()

  if (conversationError) throw conversationError

  const { data: message, error: messageError } = await admin
    .from('messages')
    .insert({
      conversation_id: conversation.id,
      user_id: userId,
      role: 'user',
      content: `${label} said something private`,
    })
    .select('id')
    .single()

  if (messageError) throw messageError

  const { data: prompt, error: promptError } = await admin
    .from('prompts')
    .insert({ user_id: userId, title: `${label}'s prompt`, body: 'private body' })
    .select('id')
    .single()

  if (promptError) throw promptError

  const { data: providerKey, error: providerKeyError } = await admin
    .from('provider_keys')
    .insert({
      user_id: userId,
      provider: 'openai',
      // Hex-encoded bytea. Contents are irrelevant; what matters is that a row
      // exists for the other user to fail to read.
      ciphertext: '\\xdeadbeef',
      iv: '\\x000102030405060708090a0b',
      auth_tag: '\\x000102030405060708090a0b0c0d0e0f',
      last_four: '4f2a',
    })
    .select('id')
    .single()

  if (providerKeyError) throw providerKeyError

  return {
    id: userId,
    email,
    password,
    client,
    conversationId: conversation.id,
    messageId: message.id,
    promptId: prompt.id,
    providerKeyId: providerKey.id,
  }
}

beforeAll(async () => {
  alice = await createActor('alice')
  bob = await createActor('bob')
})

afterAll(async () => {
  // Storage objects first: Supabase refuses to delete a user who still owns
  // any, and the failure is reported as a generic delete error.
  await admin.storage
    .from('attachments')
    .remove([`${alice?.id}/probe.txt`, `${bob?.id}/probe.txt`])

  for (const actor of [alice, bob]) {
    if (actor?.id) await admin.auth.admin.deleteUser(actor.id)
  }
})

describe('a signed-in user reading their own data', () => {
  it('sees their own conversation and nobody else’s', async () => {
    const { data, error } = await alice.client.from('conversations').select('id')

    expect(error).toBeNull()
    expect(data?.map((row) => row.id)).toEqual([alice.conversationId])
  })

  it('sees exactly one profile — their own', async () => {
    const { data, error } = await alice.client.from('profiles').select('id')

    expect(error).toBeNull()
    expect(data?.map((row) => row.id)).toEqual([alice.id])
  })
})

describe('a signed-in user reaching for another user’s rows', () => {
  it('cannot read a conversation by its id', async () => {
    const { data } = await alice.client
      .from('conversations')
      .select('id')
      .eq('id', bob.conversationId)

    expect(data).toEqual([])
  })

  it('cannot read a message by its id', async () => {
    const { data } = await alice.client
      .from('messages')
      .select('id')
      .eq('id', bob.messageId)

    expect(data).toEqual([])
  })

  it('cannot read a prompt by its id', async () => {
    const { data } = await alice.client
      .from('prompts')
      .select('id')
      .eq('id', bob.promptId)

    expect(data).toEqual([])
  })

  it('cannot read another user’s stored key material', async () => {
    const { data } = await alice.client
      .from('provider_keys')
      .select('id, ciphertext, last_four')
      .eq('id', bob.providerKeyId)

    expect(data).toEqual([])
  })

  it('cannot update a conversation it does not own', async () => {
    const { data } = await alice.client
      .from('conversations')
      .update({ title: 'seized' })
      .eq('id', bob.conversationId)
      .select('id')

    expect(data).toEqual([])

    // And the row itself is untouched, checked past RLS with the service role.
    const { data: actual } = await admin
      .from('conversations')
      .select('title')
      .eq('id', bob.conversationId)
      .single()

    expect(actual?.title).toBe("bob's private conversation")
  })

  it('cannot delete a conversation it does not own', async () => {
    const { data } = await alice.client
      .from('conversations')
      .delete()
      .eq('id', bob.conversationId)
      .select('id')

    expect(data).toEqual([])

    const { count } = await admin
      .from('conversations')
      .select('id', { count: 'exact', head: true })
      .eq('id', bob.conversationId)

    expect(count).toBe(1)
  })

  it('cannot insert a row owned by someone else', async () => {
    const { error } = await alice.client.from('conversations').insert({
      user_id: bob.id,
      provider: 'google',
      model_id: 'gemini-2.5-flash',
    })

    expect(error).not.toBeNull()
  })

  it('cannot forge a usage row against someone else’s daily allowance', async () => {
    const { error } = await alice.client.from('shared_key_usage').insert({
      user_id: bob.id,
      usage_date: new Date().toISOString().slice(0, 10),
      message_count: 999,
    })

    expect(error).not.toBeNull()
  })
})

describe('an anonymous visitor holding only the publishable key', () => {
  it('reads nothing from any table', async () => {
    for (const table of [
      'profiles',
      'provider_keys',
      'conversations',
      'messages',
      'attachments',
      'prompts',
      'shared_key_usage',
      'shared_key_budget',
    ] as const) {
      const { data } = await stranger.from(table).select('*')
      expect(data ?? []).toEqual([])
    }
  })
})

describe('public share links', () => {
  it('exposes a conversation and its messages only while the slug is set', async () => {
    // Not shared yet.
    const { data: before } = await stranger
      .from('conversations')
      .select('id')
      .eq('id', alice.conversationId)

    expect(before).toEqual([])

    await admin
      .from('conversations')
      .update({ share_slug: 'test-slug-01', shared_at: new Date().toISOString() })
      .eq('id', alice.conversationId)

    const { data: shared } = await stranger
      .from('conversations')
      .select('id')
      .eq('id', alice.conversationId)

    expect(shared?.map((row) => row.id)).toEqual([alice.conversationId])

    const { data: sharedMessages } = await stranger
      .from('messages')
      .select('id')
      .eq('conversation_id', alice.conversationId)

    expect(sharedMessages?.map((row) => row.id)).toEqual([alice.messageId])

    // Bob's conversation is still not shared, so it stays invisible throughout.
    const { data: bobsStill } = await stranger
      .from('conversations')
      .select('id')
      .eq('id', bob.conversationId)

    expect(bobsStill).toEqual([])

    // Revocation is immediate: nulling the slug is the whole mechanism.
    await admin
      .from('conversations')
      .update({ share_slug: null, shared_at: null })
      .eq('id', alice.conversationId)

    const { data: after } = await stranger
      .from('conversations')
      .select('id')
      .eq('id', alice.conversationId)

    expect(after).toEqual([])

    const { data: afterMessages } = await stranger
      .from('messages')
      .select('id')
      .eq('conversation_id', alice.conversationId)

    expect(afterMessages).toEqual([])
  })
})

describe('attachment storage', () => {
  it('keeps one user out of another’s object prefix', async () => {
    const path = `${bob.id}/probe.txt`

    const { error: uploadError } = await admin.storage
      .from('attachments')
      .upload(path, new Blob(['bob private bytes']), { upsert: true })

    expect(uploadError).toBeNull()

    const { error: downloadError } = await alice.client.storage
      .from('attachments')
      .download(path)

    expect(downloadError).not.toBeNull()

    await alice.client.storage.from('attachments').remove([path])

    // Still there. remove() reports success for paths it cannot see, so the
    // only honest check is whether the object survived.
    const { data: listed } = await admin.storage
      .from('attachments')
      .list(bob.id)

    expect(listed?.map((entry) => entry.name)).toContain('probe.txt')
  })
})
