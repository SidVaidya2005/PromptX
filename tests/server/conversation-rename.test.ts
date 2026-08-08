import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'

import { DEFAULT_CONVERSATION_TITLE } from '@/lib/constants'

import type { Database } from '@/types/database'

import { requiredEnv } from '../support/env'
import { describeHosted } from '../support/hosted'

/**
 * Rename and pin, proven against the real hosted project. (F21)
 *
 * Both writes are small enough to look obviously correct, and both have a
 * failure mode that cannot be seen by reading them:
 *
 * - **They report success for a row they never touched.** RLS makes someone
 *   else's conversation invisible rather than forbidden, so an update that
 *   matches nothing returns no error. Only the row count distinguishes it, and
 *   only a real policy can produce that — `set local role` would prove the
 *   predicate while skipping the grants and PostgREST in front of it.
 * - **They quietly reorder the sidebar.** Neither may write `updated_at`, and
 *   nothing in the type system says so.
 *
 * The last test here is the odd one: it covers behaviour F21 *inherits* rather
 * than writes. A manual rename suppresses auto-titling because `setGeneratedTitle`
 * only fires while the title is still 'New chat' — there is no column recording
 * that a human named it. That makes the guard the most deletable line in the
 * feature, so it gets the test.
 *
 * The one seam mocked is `createServerSupabaseClient()`, which reads cookies
 * through next/headers and cannot work outside a request. What replaces it is a
 * client carrying a real JWT, so the policies are still in the path — the same
 * arrangement `provider-keys.test.ts` uses.
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

/** Whose session the data module will see on the next `load()`. */
let current: SupabaseClient<Database>

type ConversationsModule = typeof import('@/server/data/conversations')

async function load(actor: Actor): Promise<ConversationsModule> {
  current = actor.client

  vi.resetModules()
  vi.doMock('@/server/supabase', () => ({
    createServerSupabaseClient: async () => current,
  }))

  return import('@/server/data/conversations')
}

async function createActor(label: string): Promise<Actor> {
  const email = `rename-${label}-${crypto.randomUUID()}@promptx.test`
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

/** Seeded with the service-role client, so a broken policy cannot empty the fixture. */
async function seedConversation(userId: string, title: string): Promise<string> {
  const { data, error } = await admin
    .from('conversations')
    .insert({
      user_id: userId,
      title,
      provider: 'google',
      model_id: 'gemini-3.6-flash',
    })
    .select('id')
    .single()

  if (error) throw error
  return data.id
}

/** Read back with the admin client — what is actually in the row, not what RLS shows. */
async function readRow(id: string) {
  const { data, error } = await admin
    .from('conversations')
    .select('title, pinned_at, updated_at')
    .eq('id', id)
    .single()

  if (error) throw error
  return data
}

beforeAll(async () => {
  ;[owner, stranger] = await Promise.all([createActor('owner'), createActor('stranger')])
}, 30_000)

afterAll(async () => {
  // allSettled, not all. These users live on the shared hosted project — there
  // is no local stack to reset — so under `Promise.all` one rejected delete
  // discards the other's outcome and leaves a real orphan behind. (F19)
  const results = await Promise.allSettled(
    [owner, stranger]
      .filter((actor): actor is Actor => actor !== undefined)
      .map((actor) => admin.auth.admin.deleteUser(actor.id)),
  )

  for (const result of results) {
    if (result.status === 'rejected') {
      console.error('[tests/conversation-rename] could not delete a fixture user', result.reason)
    }
  }
}, 30_000)

describeHosted('renameConversation', () => {
  it('writes the title and reports that a row changed', async () => {
    const data = await load(owner)
    const id = await seedConversation(owner.id, 'Before')

    expect(await data.renameConversation(id, 'After')).toBe(true)
    expect((await readRow(id)).title).toBe('After')
  })

  /**
   * The failure this function is shaped around.
   *
   * RLS filters the row out before the update sees it, so PostgREST reports no
   * error and an implementation that returned void — or `error === null` — would
   * report success for someone else's conversation. Only `.select('id')` coming
   * back empty distinguishes the two, and the route turns that into a 404 rather
   * than a 403, because confirming the id exists would itself be a disclosure.
   */
  it("returns false for a conversation the caller does not own, and changes nothing", async () => {
    const id = await seedConversation(owner.id, 'Owner only')
    const data = await load(stranger)

    expect(await data.renameConversation(id, 'Stolen')).toBe(false)
    expect((await readRow(id)).title).toBe('Owner only')
  })

  /**
   * Verified by mutation: adding `updated_at: new Date().toISOString()` to the
   * update in `renameConversation` turns this red on its own.
   */
  it('leaves updated_at alone, so naming a conversation does not reorder the sidebar', async () => {
    const data = await load(owner)
    const id = await seedConversation(owner.id, 'Before')
    const before = await readRow(id)

    await data.renameConversation(id, 'A name I chose')

    expect((await readRow(id)).updated_at).toBe(before.updated_at)
  })
})

describeHosted('setConversationPinned', () => {
  it('sets pinned_at, and clears it again', async () => {
    const data = await load(owner)
    const id = await seedConversation(owner.id, 'Pin me')

    expect(await data.setConversationPinned(id, true)).toBe(true)
    expect((await readRow(id)).pinned_at).not.toBeNull()

    expect(await data.setConversationPinned(id, false)).toBe(true)
    expect((await readRow(id)).pinned_at).toBeNull()
  })

  /**
   * Why this takes desired state rather than toggling.
   *
   * A toggle is implementable atomically — `case when pinned_at is null` — so
   * this is not about a race. It is that a delta undoes itself when the same
   * request arrives twice, which a double-clicked menu item and a retried fetch
   * both produce. Sending state means the second one is a no-op.
   */
  it('is idempotent: pinning twice leaves it pinned, unpinning twice leaves it clear', async () => {
    const data = await load(owner)
    const id = await seedConversation(owner.id, 'Twice')

    await data.setConversationPinned(id, true)
    const first = await readRow(id)

    await data.setConversationPinned(id, true)
    expect((await readRow(id)).pinned_at).not.toBeNull()
    expect(first.pinned_at).not.toBeNull()

    await data.setConversationPinned(id, false)
    await data.setConversationPinned(id, false)
    expect((await readRow(id)).pinned_at).toBeNull()
  })

  it("returns false for a conversation the caller does not own, and changes nothing", async () => {
    const id = await seedConversation(owner.id, 'Owner only')
    const data = await load(stranger)

    expect(await data.setConversationPinned(id, true)).toBe(false)
    expect((await readRow(id)).pinned_at).toBeNull()
  })

  /**
   * The case where an `updated_at` touch would be most visible: it would reorder
   * the row *inside* the Pinned group for a click that produced no message.
   */
  it('leaves updated_at alone', async () => {
    const data = await load(owner)
    const id = await seedConversation(owner.id, 'Steady')
    const before = await readRow(id)

    await data.setConversationPinned(id, true)

    expect((await readRow(id)).updated_at).toBe(before.updated_at)
  })
})

/**
 * F21 does not implement "a manual rename suppresses auto-titling". It inherits
 * it, from a guard F10 wrote for a different reason — which is exactly why it is
 * tested here. Someone tidying `setGeneratedTitle` later can see the `.eq()` is
 * redundant with the caller's own check and delete it, and nothing would fail
 * until a real conversation someone had named was renamed underneath them by the
 * titler.
 *
 * Verified by mutation: removing `.eq('title', DEFAULT_CONVERSATION_TITLE)` from
 * `setGeneratedTitle` turns the first of these red and leaves the second green.
 */
describeHosted('setGeneratedTitle after a rename', () => {
  it('declines to rename a conversation the user has already named', async () => {
    const data = await load(owner)
    const id = await seedConversation(owner.id, DEFAULT_CONVERSATION_TITLE)

    await data.renameConversation(id, 'Mortgage questions')

    expect(await data.setGeneratedTitle(id, 'A Model-Chosen Title')).toBe(false)
    expect((await readRow(id)).title).toBe('Mortgage questions')
  })

  it('still names one that is untouched, so the guard is not simply always false', async () => {
    const data = await load(owner)
    const id = await seedConversation(owner.id, DEFAULT_CONVERSATION_TITLE)

    expect(await data.setGeneratedTitle(id, 'A Model-Chosen Title')).toBe(true)
    expect((await readRow(id)).title).toBe('A Model-Chosen Title')
  })
})
