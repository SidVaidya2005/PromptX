import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import type { Database } from '@/types/database'

import { requiredEnv } from '../support/env'

/**
 * Archive, proven against the real hosted project. (F22)
 *
 * The write itself is one nullable column, so what is worth testing is not that
 * it sets a timestamp — it is the three things around it that nothing in the
 * type system holds:
 *
 * - **It reports success for a row it never touched.** The RLS no-op again;
 *   only `.select('id')` coming back empty tells archiving someone else's
 *   conversation apart from archiving your own.
 * - **It leaves `pinned_at` alone.** Unarchiving is supposed to put a row back
 *   exactly where it was, and nothing connects the two columns except this.
 * - **`includeArchived` widens and never narrows.** A flag that filtered the
 *   wrong way round would hide live conversations, which is the one failure
 *   here that would look like data loss.
 *
 * `createServerSupabaseClient()` is the only seam mocked, replaced by a client
 * carrying a real JWT — the F21 arrangement, so the policies stay in the path.
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
  const email = `archive-${label}-${crypto.randomUUID()}@promptx.test`
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
async function seedConversation(
  userId: string,
  overrides: { title: string; pinned_at?: string; archived_at?: string },
): Promise<string> {
  const { data, error } = await admin
    .from('conversations')
    .insert({
      user_id: userId,
      provider: 'google',
      model_id: 'gemini-3.6-flash',
      ...overrides,
    })
    .select('id')
    .single()

  if (error) throw error
  return data.id
}

async function readRow(id: string) {
  const { data, error } = await admin
    .from('conversations')
    .select('title, pinned_at, archived_at, updated_at')
    .eq('id', id)
    .single()

  if (error) throw error
  return data
}

beforeAll(async () => {
  ;[owner, stranger] = await Promise.all([createActor('owner'), createActor('stranger')])
}, 30_000)

afterAll(async () => {
  // allSettled, not all — one rejected delete under `all` discards the other's
  // outcome and leaves a real orphan on a project with no reset. (F19)
  const results = await Promise.allSettled(
    [owner, stranger]
      .filter((actor): actor is Actor => actor !== undefined)
      .map((actor) => admin.auth.admin.deleteUser(actor.id)),
  )

  for (const result of results) {
    if (result.status === 'rejected') {
      console.error(
        '[tests/conversation-archive] could not delete a fixture user',
        result.reason,
      )
    }
  }
}, 30_000)

describe('setConversationArchived', () => {
  it('sets archived_at, and clears it again', async () => {
    const data = await load(owner)
    const id = await seedConversation(owner.id, { title: 'Put me away' })

    expect(await data.setConversationArchived(id, true)).toBe(true)
    expect((await readRow(id)).archived_at).not.toBeNull()

    expect(await data.setConversationArchived(id, false)).toBe(true)
    expect((await readRow(id)).archived_at).toBeNull()
  })

  it('is idempotent in both directions', async () => {
    const data = await load(owner)
    const id = await seedConversation(owner.id, { title: 'Twice' })

    await data.setConversationArchived(id, true)
    await data.setConversationArchived(id, true)
    expect((await readRow(id)).archived_at).not.toBeNull()

    await data.setConversationArchived(id, false)
    await data.setConversationArchived(id, false)
    expect((await readRow(id)).archived_at).toBeNull()
  })

  it("returns false for a conversation the caller does not own, and changes nothing", async () => {
    const id = await seedConversation(owner.id, { title: 'Owner only' })
    const data = await load(stranger)

    expect(await data.setConversationArchived(id, true)).toBe(false)
    expect((await readRow(id)).archived_at).toBeNull()
  })

  /**
   * Verified by mutation: adding `updated_at: new Date().toISOString()` to the
   * update turns this red. Archiving is the user saying they are done with a
   * conversation, so floating it up the ordering is the exact opposite of what
   * was asked for — and it still matters while the row is hidden, because
   * unarchiving has to put it back where it was.
   */
  it('leaves updated_at alone', async () => {
    const data = await load(owner)
    const id = await seedConversation(owner.id, { title: 'Steady' })
    const before = await readRow(id)

    await data.setConversationArchived(id, true)

    expect((await readRow(id)).updated_at).toBe(before.updated_at)
  })

  /**
   * The one nothing in the type system connects.
   *
   * `groupConversations` files a row that is both under Archived, so the pin is
   * invisible while it is archived — which is exactly why clearing it here would
   * go unnoticed until someone unarchived a conversation weeks later and found
   * it had quietly stopped being pinned.
   */
  it('leaves pinned_at alone, so unarchiving restores the pin', async () => {
    const data = await load(owner)
    const id = await seedConversation(owner.id, {
      title: 'Pinned and filed',
      pinned_at: new Date().toISOString(),
    })

    // Read back rather than compared against what was sent: Postgres renders
    // the offset as `+00:00` where JavaScript writes `Z`, so the stored string
    // is the only thing an equality check can be about.
    const seeded = await readRow(id)
    expect(seeded.pinned_at).not.toBeNull()

    await data.setConversationArchived(id, true)
    expect((await readRow(id)).pinned_at).toBe(seeded.pinned_at)

    await data.setConversationArchived(id, false)

    const after = await readRow(id)
    expect(after.pinned_at).toBe(seeded.pinned_at)
    expect(after.archived_at).toBeNull()
  })
})

describe('listConversations', () => {
  it('omits archived rows by default and includes them when asked', async () => {
    const data = await load(owner)
    const live = await seedConversation(owner.id, { title: 'Still here' })
    const filed = await seedConversation(owner.id, {
      title: 'Filed away',
      archived_at: new Date().toISOString(),
    })

    const hidden = await data.listConversations()
    const hiddenIds = hidden.map((row) => row.id)

    expect(hiddenIds).toContain(live)
    expect(hiddenIds).not.toContain(filed)

    const revealed = await data.listConversations(true)
    const revealedIds = revealed.map((row) => row.id)

    // Widens, never narrows. A flag filtering the wrong way round would hide
    // live conversations, which is the failure here that looks like data loss.
    expect(revealedIds).toContain(live)
    expect(revealedIds).toContain(filed)
  })

  it('carries archived_at, which is what the sidebar groups on', async () => {
    const data = await load(owner)
    const filed = await seedConversation(owner.id, {
      title: 'Filed away too',
      archived_at: new Date().toISOString(),
    })

    const row = (await data.listConversations(true)).find(
      (candidate) => candidate.id === filed,
    )

    expect(row?.archived_at).not.toBeNull()
  })
})
