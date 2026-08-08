import { readFileSync } from 'node:fs'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  ALLOWED_ATTACHMENT_MIME_TYPES,
  ATTACHMENT_ORPHAN_TTL_HOURS,
  MAX_ATTACHMENT_BYTES,
} from '@/lib/constants'

import type { Database } from '@/types/database'

import { requiredEnv } from '../support/env'

/**
 * The upload pipeline, tested where it actually lives. (F28)
 *
 * Most of what F28 promises is not in TypeScript at all: the size and mime caps
 * are enforced by the bucket at the moment bytes land, the link is a Postgres
 * function, and the reaper is a Deno function on Supabase's infrastructure. So
 * this suite talks to the hosted project over HTTP, uploads real bytes through
 * real signed URLs, and reads the results back — the F03 pattern, for the same
 * reason: anything less proves the code and not the guarantee.
 *
 * Fixtures are seeded with the SERVICE-ROLE client and asserted through a
 * publishable-key client carrying a real session, so a broken policy cannot make
 * a test pass by leaving a table empty.
 */

const SUPABASE_URL = requiredEnv('NEXT_PUBLIC_SUPABASE_URL')
const PUBLISHABLE_KEY = requiredEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY')
const SECRET_KEY = requiredEnv('SUPABASE_SECRET_KEY')

const admin = createClient<Database>(SUPABASE_URL, SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

type Actor = {
  id: string
  accessToken: string
  client: SupabaseClient<Database>
}

let owner: Actor
let stranger: Actor

/** Every object this suite creates, so teardown can clear the prefixes. */
const createdPaths: string[] = []

async function createActor(label: string): Promise<Actor> {
  const email = `attach-${label}-${crypto.randomUUID()}@promptx.test`
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

  const { data: session, error: signInError } = await client.auth.signInWithPassword({
    email,
    password,
  })

  if (signInError || !session.session) {
    throw new Error(`could not sign in ${label}: ${signInError?.message}`)
  }

  return { id: created.user.id, accessToken: session.session.access_token, client }
}

/** A draft row, seeded as service role. Objects are uploaded separately. */
async function seedAttachment(
  actor: Actor,
  overrides: Partial<Database['public']['Tables']['attachments']['Insert']> = {},
): Promise<string> {
  const id = crypto.randomUUID()
  const storagePath = `${actor.id}/${id}.png`

  const { error } = await admin.from('attachments').insert({
    id,
    user_id: actor.id,
    storage_path: storagePath,
    mime_type: 'image/png',
    size_bytes: 100,
    status: 'ready',
    ...overrides,
  })

  if (error) throw error

  return id
}

async function seedMessage(actor: Actor): Promise<string> {
  const { data: conversation, error: conversationError } = await admin
    .from('conversations')
    .insert({
      user_id: actor.id,
      title: 'attachment fixture',
      provider: 'google',
      model_id: 'gemini-3.6-flash',
    })
    .select('id')
    .single()

  if (conversationError) throw conversationError

  const { data: message, error: messageError } = await admin
    .from('messages')
    .insert({
      conversation_id: conversation.id,
      user_id: actor.id,
      role: 'user',
      content: 'here are some files',
    })
    .select('id')
    .single()

  if (messageError) throw messageError

  return message.id
}

beforeAll(async () => {
  owner = await createActor('owner')
  stranger = await createActor('stranger')
})

afterAll(async () => {
  // Objects before users: Supabase refuses to delete a user who still owns any,
  // and reports it as a generic delete failure that looks nothing like the
  // cause. (F03)
  if (createdPaths.length > 0) {
    await admin.storage.from('attachments').remove(createdPaths)
  }

  // allSettled, not all — one rejected delete under `all` discards the other's
  // outcome and silently leaves a fixture user on a project with no reset. (F19)
  const results = await Promise.allSettled(
    [owner, stranger]
      .filter((actor): actor is Actor => actor !== undefined)
      .map((actor) => admin.auth.admin.deleteUser(actor.id)),
  )

  for (const result of results) {
    if (result.status === 'rejected') {
      console.error('[tests/attachments] teardown failed', result.reason)
    }
  }
})

describe('the attachments bucket', () => {
  /**
   * The one place the SQL and `src/lib/constants.ts` could drift. SQL cannot
   * import TypeScript, so the migration restates both figures — and a limit that
   * silently stopped matching the constant would let the application accept a
   * file the bucket then refuses, or the reverse.
   */
  it('enforces exactly the limits the constants declare', async () => {
    const { data, error } = await admin.storage.getBucket('attachments')

    expect(error).toBeNull()
    expect(data?.public).toBe(false)
    // snake_case, unlike `info()`'s camelized object one method along. Read off
    // the installed `Bucket` type rather than guessed — the first spelling here
    // was camelCase, which compiles and asserts `undefined` against a number.
    expect(data?.file_size_limit).toBe(MAX_ATTACHMENT_BYTES)
    expect(data?.allowed_mime_types?.slice().sort()).toEqual(
      [...ALLOWED_ATTACHMENT_MIME_TYPES].sort(),
    )
  })

  /**
   * The claim §28 makes about why these limits matter at all: the application is
   * never in the byte path, so nothing it checked when issuing the URL
   * constrains what lands. This is the check that actually runs at that moment.
   */
  it('refuses an oversized upload through a signed URL', async () => {
    const path = `${owner.id}/${crypto.randomUUID()}-oversized.png`
    createdPaths.push(path)

    const { data: signed, error } = await owner.client.storage
      .from('attachments')
      .createSignedUploadUrl(path)

    expect(error).toBeNull()

    const oversized = new Blob([new Uint8Array(MAX_ATTACHMENT_BYTES + 1024)], {
      type: 'image/png',
    })

    const response = await fetch(signed?.signedUrl ?? '', {
      method: 'PUT',
      headers: { 'Content-Type': 'image/png' },
      body: oversized,
    })

    expect(response.ok).toBe(false)
  })

  it('refuses a disallowed mime type through a signed URL', async () => {
    const path = `${owner.id}/${crypto.randomUUID()}-script.svg`
    createdPaths.push(path)

    const { data: signed } = await owner.client.storage
      .from('attachments')
      .createSignedUploadUrl(path)

    // SVG is markup a browser will execute, which is why it is off the
    // allowlist. Nothing in the application would issue a URL for one; this is
    // what happens if something did.
    const response = await fetch(signed?.signedUrl ?? '', {
      method: 'PUT',
      headers: { 'Content-Type': 'image/svg+xml' },
      body: new Blob(['<svg xmlns="http://www.w3.org/2000/svg"/>'], {
        type: 'image/svg+xml',
      }),
    })

    expect(response.ok).toBe(false)
  })

  it('keeps a signed upload URL inside its own owner’s prefix', async () => {
    // The storage policies match the FIRST path segment against auth.uid() and
    // nothing else, so this is the whole of the isolation guarantee.
    const { data, error } = await owner.client.storage
      .from('attachments')
      .createSignedUploadUrl(`${stranger.id}/${crypto.randomUUID()}.png`)

    expect(data).toBeNull()
    expect(error).not.toBeNull()
  })
})

describe('link_attachments_to_message', () => {
  it('assigns position from the order of the ids, not from the rows', async () => {
    const messageId = await seedMessage(owner)
    const first = await seedAttachment(owner)
    const second = await seedAttachment(owner)
    const third = await seedAttachment(owner)

    // Deliberately not creation order: the composer can reorder right up to the
    // send, so the array is the only thing that knows the intended arrangement.
    const ids = [third, first, second]

    const { data: linked, error } = await owner.client.rpc(
      'link_attachments_to_message',
      { p_message_id: messageId, p_ids: ids },
    )

    expect(error).toBeNull()
    expect(linked).toBe(3)

    const { data: rows } = await admin
      .from('attachments')
      .select('id, position')
      .eq('message_id', messageId)
      .order('position')

    expect(rows?.map((row) => row.id)).toEqual(ids)
    expect(rows?.map((row) => row.position)).toEqual([0, 1, 2])
  })

  it('refuses a draft that has not been confirmed', async () => {
    const messageId = await seedMessage(owner)
    const pending = await seedAttachment(owner, { status: 'pending' })

    const { data: linked } = await owner.client.rpc('link_attachments_to_message', {
      p_message_id: messageId,
      p_ids: [pending],
    })

    // Zero, not an error: the route compares the count against what it sent and
    // treats the shortfall as a failure. §28 is explicit that a pending row is
    // reported rather than silently attached.
    expect(linked).toBe(0)

    const { data: row } = await admin
      .from('attachments')
      .select('message_id')
      .eq('id', pending)
      .single()

    expect(row?.message_id).toBeNull()
  })

  it('refuses an attachment that has already been sent', async () => {
    const firstMessage = await seedMessage(owner)
    const secondMessage = await seedMessage(owner)
    const id = await seedAttachment(owner)

    await owner.client.rpc('link_attachments_to_message', {
      p_message_id: firstMessage,
      p_ids: [id],
    })

    const { data: relinked } = await owner.client.rpc('link_attachments_to_message', {
      p_message_id: secondMessage,
      p_ids: [id],
    })

    expect(relinked).toBe(0)

    const { data: row } = await admin
      .from('attachments')
      .select('message_id')
      .eq('id', id)
      .single()

    // Still on the first message. A re-link would move a file out of a message
    // somebody has already read.
    expect(row?.message_id).toBe(firstMessage)
  })

  it('cannot attach someone else’s file to your message', async () => {
    const messageId = await seedMessage(owner)
    const theirs = await seedAttachment(stranger)

    const { data: linked } = await owner.client.rpc('link_attachments_to_message', {
      p_message_id: messageId,
      p_ids: [theirs],
    })

    // RLS is what refuses this: the update policy on attachments never sees the
    // row, so there is nothing for the statement to match.
    expect(linked).toBe(0)
  })

  it('cannot attach your file to someone else’s message', async () => {
    const theirMessage = await seedMessage(stranger)
    const mine = await seedAttachment(owner)

    const { data: linked } = await owner.client.rpc('link_attachments_to_message', {
      p_message_id: theirMessage,
      p_ids: [mine],
    })

    // The `exists (select 1 from messages …)` guard, scoped by the owner-read
    // policy — someone else's message id simply does not exist from in there.
    expect(linked).toBe(0)
  })
})

describe('orphaned_attachment_objects', () => {
  it('finds an object whose row was cascaded away, and leaves the rest alone', async () => {
    const kept = `${owner.id}/${crypto.randomUUID()}-kept.png`
    const stray = `${owner.id}/${crypto.randomUUID()}-stray.png`
    createdPaths.push(kept, stray)

    const png = new Blob(['fixture'], { type: 'image/png' })

    for (const path of [kept, stray]) {
      const { error } = await admin.storage
        .from('attachments')
        .upload(path, png, { contentType: 'image/png', upsert: true })

      expect(error).toBeNull()
    }

    // `kept` has a row pointing at it; `stray` is what a deleted conversation
    // leaves behind once the cascade has taken its row.
    const keptId = crypto.randomUUID()
    await admin.from('attachments').insert({
      id: keptId,
      user_id: owner.id,
      storage_path: kept,
      mime_type: 'image/png',
      size_bytes: 7,
      status: 'ready',
    })

    // Both objects were created moments ago, so the age bound should exclude
    // them entirely — this is the guard that stops the sweep eating an upload
    // that is still in flight.
    const { data: young } = await admin.rpc('orphaned_attachment_objects', {
      p_older_than: `${ATTACHMENT_ORPHAN_TTL_HOURS} hours`,
      p_limit: 1000,
    })

    expect(young?.map((row) => row.object_name) ?? []).not.toContain(stray)

    // With no age bound at all, only the object nothing points at comes back.
    const { data: all } = await admin.rpc('orphaned_attachment_objects', {
      p_older_than: '0 seconds',
      p_limit: 1000,
    })

    const names = all?.map((row) => row.object_name) ?? []

    expect(names).toContain(stray)
    expect(names).not.toContain(kept)
  })

  it('is unreachable by a signed-in user', async () => {
    // Execute is granted to service_role alone. It reads storage.objects across
    // every user, so a caller without BYPASSRLS has no business in it.
    const { error } = await owner.client.rpc('orphaned_attachment_objects', {
      p_older_than: '0 seconds',
      p_limit: 10,
    })

    expect(error).not.toBeNull()
  })
})

describe('the reap-attachments Edge Function', () => {
  const endpoint = `${SUPABASE_URL}/functions/v1/reap-attachments`

  it('refuses a caller who is merely signed in', async () => {
    // The case the platform's own `verify_jwt` would have allowed: it checks
    // only that a JWT was signed by this project, and this function deletes
    // things. The function's own probe is what refuses a user token.
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${owner.accessToken}` },
    })

    expect(response.status).toBe(401)
  })

  it('refuses the publishable key and an absent bearer', async () => {
    const anonymous = await fetch(endpoint, { method: 'POST' })
    expect(anonymous.status).toBe(401)

    const publishable = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${PUBLISHABLE_KEY}` },
    })

    expect(publishable.status).toBe(401)
  })

  /**
   * The Deno function cannot import from `src/lib/constants.ts`, so it restates
   * the TTL. This is the only thing holding the two together — and a reaper
   * sweeping on a different bound from the one the application documents would
   * delete uploads people were still working on.
   */
  it('sweeps on the same TTL the constants declare', () => {
    const source = readFileSync('supabase/functions/reap-attachments/index.ts', 'utf8')
    const declared = source.match(/const ORPHAN_TTL_HOURS = (\d+)/)?.[1]

    expect(declared).toBe(String(ATTACHMENT_ORPHAN_TTL_HOURS))
  })
})
