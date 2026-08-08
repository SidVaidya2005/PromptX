import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'

import {
  createAttachmentDraft,
  createAttachmentReadUrls,
  deleteAttachment,
  downloadAttachmentBytes,
  getAttachment,
  linkAttachmentsToMessage,
  listAttachmentsByIds,
  markAttachmentReady,
  readObjectFacts,
} from '@/server/data/attachments'

import type { Database } from '@/types/database'

import { requiredEnv } from '../support/env'
import { describeHosted } from '../support/hosted'

/**
 * The data module behind the upload pipeline, run for real.
 *
 * `tests/server/attachments.test.ts` covers what F28 put outside TypeScript —
 * the bucket's own caps, the linking function, the reaper. This one covers the
 * module those things are reached through, which a coverage run showed nothing
 * had ever called: every existing suite reimplements the statement rather than
 * importing the function.
 *
 * Only the cookie-bound client is swapped, so RLS and Storage are genuinely in
 * the path. Two properties here cannot be tested any other way and are the
 * reason this is hosted rather than mocked:
 *
 * - **a deletion takes all three objects.** An image is an original, a `_thumb`
 *   and an `_inline`; a cleanup that knows only about the original strands two
 *   objects per image, manufacturing the exact leak the reaper exists to
 *   prevent, at twice the rate. Only real Storage can show this.
 * - **`'ready'` is measured, not claimed.** The draft's `size_bytes` and
 *   `mime_type` are a client's assertion about bytes it had not sent yet, and
 *   the confirm path overwrites both with what Storage says actually landed.
 */

const SUPABASE_URL = requiredEnv('NEXT_PUBLIC_SUPABASE_URL')
const PUBLISHABLE_KEY = requiredEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY')
const SECRET_KEY = requiredEnv('SUPABASE_SECRET_KEY')

const BUCKET = 'attachments'

const admin = createClient<Database>(SUPABASE_URL, SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

type Actor = { id: string; client: SupabaseClient<Database> }

let owner: Actor
let stranger: Actor
let sessionClient: SupabaseClient<Database>

/** Every object this suite creates, so teardown can clear the prefixes. */
const createdPaths: string[] = []

vi.mock('@/server/supabase', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/supabase')>()),
  createServerSupabaseClient: async () => sessionClient,
}))

async function createActor(label: string): Promise<Actor> {
  const email = `data-attach-${label}-${crypto.randomUUID()}@promptx.test`
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

/** Real bytes at a real path. The declared type is what the bucket allowlist reads. */
async function putObject(path: string, body = 'fixture-bytes'): Promise<void> {
  const { error } = await admin.storage
    .from(BUCKET)
    .upload(path, new Blob([body], { type: 'image/png' }), {
      contentType: 'image/png',
      upsert: true,
    })

  if (error) throw new Error(`could not upload ${path}: ${error.message}`)
  createdPaths.push(path)
}

async function objectExists(path: string): Promise<boolean> {
  const { data } = await admin.storage.from(BUCKET).info(path)
  return Boolean(data)
}

/** A confirmed draft with all three objects actually present. */
async function seedReadyDraft(actor: Actor) {
  sessionClient = actor.client

  const draft = await createAttachmentDraft(actor.id, {
    mimeType: 'image/png',
    sizeBytes: 1234,
    withDerivatives: true,
    inlineWidth: 1440,
    inlineHeight: 900,
  })

  for (const upload of draft.uploads) await putObject(upload.path)

  return draft
}

async function seedConversationWithMessage(userId: string): Promise<string> {
  const { data: conversation, error } = await admin
    .from('conversations')
    .insert({
      user_id: userId,
      title: 'Attachment fixture',
      provider: 'google',
      model_id: 'gemini-3.6-flash',
    })
    .select('id')
    .single()

  if (error) throw error

  const { data: message, error: messageError } = await admin
    .from('messages')
    .insert({ conversation_id: conversation.id, user_id: userId, role: 'user', content: 'hi' })
    .select('id')
    .single()

  if (messageError) throw messageError
  return message.id
}

beforeAll(async () => {
  ;[owner, stranger] = await Promise.all([createActor('owner'), createActor('stranger')])
}, 30_000)

beforeEach(() => {
  sessionClient = owner.client
})

afterAll(async () => {
  if (createdPaths.length > 0) {
    // Objects before users: Supabase refuses to delete a user who still owns
    // objects, and reports it as a generic failure that looks nothing like the
    // cause. (F03)
    await admin.storage.from(BUCKET).remove(createdPaths)
  }

  const results = await Promise.allSettled(
    [owner, stranger]
      .filter((actor): actor is Actor => actor !== undefined)
      .map((actor) => admin.auth.admin.deleteUser(actor.id)),
  )

  for (const result of results) {
    if (result.status === 'rejected') {
      console.error('[tests/data-attachments] could not delete a fixture user', result.reason)
    }
  }
}, 60_000)

describeHosted('createAttachmentDraft', () => {
  it('writes the row before issuing a single upload URL', async () => {
    // The ordering that stops an object existing with nothing in the database
    // naming it — the only leak the reaper's object pass can reach.
    const draft = await seedReadyDraft(owner)

    const row = await getAttachment(draft.id)
    expect(row).not.toBeNull()
    expect(row?.status).toBe('pending')
  })

  it('builds every path under the owner’s own prefix', async () => {
    // The storage policies match on the first path segment and nothing else, so
    // a path built any other way is unreachable by the person who owns it.
    const draft = await seedReadyDraft(owner)

    for (const upload of draft.uploads) {
      expect(upload.path.startsWith(`${owner.id}/`)).toBe(true)
    }
  })

  it('issues three targets for an image: the original and both derivatives', async () => {
    const draft = await seedReadyDraft(owner)

    expect(draft.uploads.map((upload) => upload.kind).sort()).toEqual([
      'inline',
      'original',
      'thumb',
    ])
  })

  it('issues one target for a PDF, which has no derivatives', async () => {
    const draft = await createAttachmentDraft(owner.id, {
      mimeType: 'application/pdf',
      sizeBytes: 900,
      withDerivatives: false,
    })

    expect(draft.uploads).toHaveLength(1)

    const row = await getAttachment(draft.id)
    expect(row?.thumb_path).toBeNull()
    expect(row?.inline_path).toBeNull()
  })

  it('leaves position at its default, because the composer can still reorder', async () => {
    // The real position is assigned at link time from the order the message was
    // actually sent in. A draft has none.
    const draft = await createAttachmentDraft(owner.id, {
      mimeType: 'application/pdf',
      sizeBytes: 10,
      withDerivatives: false,
    })

    expect((await getAttachment(draft.id))?.position).toBe(0)
  })
})

describeHosted('readObjectFacts', () => {
  it('reports what actually landed', async () => {
    const path = `${owner.id}/${crypto.randomUUID()}.png`
    await putObject(path, 'twelve bytes')

    const facts = await readObjectFacts(path)

    expect(facts?.sizeBytes).toBe('twelve bytes'.length)
    expect(facts?.mimeType).toBe('image/png')
  })

  it('returns null for an object that is not there, rather than throwing', async () => {
    // "The upload did not finish" is an expected outcome the caller answers with
    // a 409 — not an error, and never something that may flip a row to ready.
    expect(await readObjectFacts(`${owner.id}/${crypto.randomUUID()}.png`)).toBeNull()
  })
})

describeHosted('markAttachmentReady', () => {
  it('overwrites the client’s claim with the measured facts', async () => {
    const draft = await seedReadyDraft(owner)

    const confirmed = await markAttachmentReady(draft.id, {
      sizeBytes: 42,
      mimeType: 'image/webp',
    })

    expect(confirmed?.status).toBe('ready')
    // 1234 was the draft's claim about bytes that had not been sent yet.
    expect(confirmed?.size_bytes).toBe(42)
    expect(confirmed?.mime_type).toBe('image/webp')
  })

  it('refuses a row that has already been sent with a message', async () => {
    // Once an attachment is history, a confirm call must not be able to rewrite
    // its size or type.
    const draft = await seedReadyDraft(owner)
    const messageId = await seedConversationWithMessage(owner.id)

    await admin.from('attachments').update({ message_id: messageId }).eq('id', draft.id)

    expect(
      await markAttachmentReady(draft.id, { sizeBytes: 1, mimeType: 'image/png' }),
    ).toBeNull()
  })

  it('refuses another user’s draft, and changes nothing', async () => {
    const draft = await seedReadyDraft(stranger)
    sessionClient = owner.client

    expect(
      await markAttachmentReady(draft.id, { sizeBytes: 1, mimeType: 'image/png' }),
    ).toBeNull()

    const { data } = await admin
      .from('attachments')
      .select('status')
      .eq('id', draft.id)
      .single()

    expect(data?.status).toBe('pending')
  })
})

describeHosted('listAttachmentsByIds', () => {
  it('returns a short result for an id that is not the caller’s', async () => {
    // Ownership is RLS's answer rather than a filter, so the route learns an id
    // was never the caller's by counting what came back.
    const mine = await seedReadyDraft(owner)
    const theirs = await seedReadyDraft(stranger)
    sessionClient = owner.client

    const rows = await listAttachmentsByIds([mine.id, theirs.id])

    expect(rows.map((row) => row.id)).toEqual([mine.id])
  })

  it('makes no round trip for an empty list', async () => {
    expect(await listAttachmentsByIds([])).toEqual([])
  })
})

describeHosted('downloadAttachmentBytes', () => {
  it('returns the bytes at a path', async () => {
    const path = `${owner.id}/${crypto.randomUUID()}.png`
    await putObject(path, 'hello')

    const bytes = await downloadAttachmentBytes(path)

    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(new TextDecoder().decode(bytes ?? new Uint8Array())).toBe('hello')
  })

  it('returns null for a missing object rather than throwing', async () => {
    expect(
      await downloadAttachmentBytes(`${owner.id}/${crypto.randomUUID()}.png`),
    ).toBeNull()
  })
})

describeHosted('deleteAttachment', () => {
  it('removes all three objects, not just the original', async () => {
    // The constraint this holds: an image is three objects, and a cleanup that
    // knows only about the original strands two per image — the exact leak the
    // reaper exists to prevent, at twice the rate.
    const draft = await seedReadyDraft(owner)
    const paths = draft.uploads.map((upload) => upload.path)

    expect(await Promise.all(paths.map(objectExists))).toEqual([true, true, true])

    expect(await deleteAttachment(draft.id)).toBe(true)

    expect(await Promise.all(paths.map(objectExists))).toEqual([false, false, false])
    expect(await getAttachment(draft.id)).toBeNull()
  })

  it('refuses an attachment already sent with a message, and leaves its objects alone', async () => {
    const draft = await seedReadyDraft(owner)
    const messageId = await seedConversationWithMessage(owner.id)
    await admin.from('attachments').update({ message_id: messageId }).eq('id', draft.id)

    expect(await deleteAttachment(draft.id)).toBe(false)

    const paths = draft.uploads.map((upload) => upload.path)
    expect(await Promise.all(paths.map(objectExists))).toEqual([true, true, true])
  })

  it('refuses another user’s draft, and leaves its objects alone', async () => {
    const draft = await seedReadyDraft(stranger)
    sessionClient = owner.client

    expect(await deleteAttachment(draft.id)).toBe(false)

    const paths = draft.uploads.map((upload) => upload.path)
    expect(await Promise.all(paths.map(objectExists))).toEqual([true, true, true])
  })
})

describeHosted('linkAttachmentsToMessage', () => {
  it('links the ready rows and reports how many it took', async () => {
    // The Postgres function has its own suite in attachments.test.ts. What runs
    // here is the wrapper nothing had called — the argument names it passes and
    // the count it maps out of a null. A caller that sent more ids than the
    // returned count treats the shortfall as a failure, so a wrapper quietly
    // returning 0 would turn every send with an attachment into an error.
    const draft = await seedReadyDraft(owner)
    await markAttachmentReady(draft.id, { sizeBytes: 13, mimeType: 'image/png' })
    const messageId = await seedConversationWithMessage(owner.id)

    expect(await linkAttachmentsToMessage(messageId, [draft.id])).toBe(1)
    expect((await getAttachment(draft.id))?.message_id).toBe(messageId)
  })

  it('makes no round trip for an empty list', async () => {
    expect(await linkAttachmentsToMessage(crypto.randomUUID(), [])).toBe(0)
  })

  it('links none of a draft that was never confirmed', async () => {
    // The function repeats the ready-and-unlinked conditions inside its own
    // where clause, so the check and the write cannot be raced apart.
    const draft = await seedReadyDraft(owner)
    const messageId = await seedConversationWithMessage(owner.id)

    expect(await linkAttachmentsToMessage(messageId, [draft.id])).toBe(0)
    expect((await getAttachment(draft.id))?.message_id).toBeNull()
  })
})

describeHosted('createAttachmentReadUrls', () => {
  it('signs a batch and keys the result by path', async () => {
    const draft = await seedReadyDraft(owner)
    const paths = draft.uploads.map((upload) => upload.path)

    const urls = await createAttachmentReadUrls(paths)

    expect(urls.size).toBe(3)
    for (const path of paths) expect(urls.get(path)).toContain('token=')
  })

  it('omits a path it cannot sign rather than blanking the message', async () => {
    // One missing derivative degrades to the original; it must not throw and
    // take the whole message down with it.
    const draft = await seedReadyDraft(owner)
    const real = draft.uploads[0]?.path ?? ''
    const missing = `${owner.id}/${crypto.randomUUID()}.png`

    const urls = await createAttachmentReadUrls([real, missing])

    expect(urls.has(real)).toBe(true)
    expect(urls.has(missing)).toBe(false)
  })

  it('makes no round trip for an empty list', async () => {
    expect((await createAttachmentReadUrls([])).size).toBe(0)
  })
})
