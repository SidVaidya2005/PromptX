import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'

import type { Database } from '@/types/database'

import { requiredEnv } from '../support/env'
import { describeHosted } from '../support/hosted'

/**
 * The prompt library's data module, against the real hosted project. (F24)
 *
 * The `prompts` table has existed since F02 and nothing has ever written to it,
 * so this suite is the first thing to prove any of it works — the four owner
 * policies included. Three claims are worth the round trips:
 *
 * - **A write that RLS filters out is not an error.** Every mutation here has to
 *   distinguish "matched nothing" from "succeeded", which is what makes a 404
 *   possible at the route.
 * - **`updated_at` moves on an edit**, which is the one place F24 deliberately
 *   departs from the rule four conversation writes follow. There is no trigger
 *   on the column, so if `updatePrompt()` stops setting it the grid silently
 *   stops reordering and nothing else notices.
 * - **The ordering is `updated_at` descending**, which is what makes an edited
 *   prompt come back to the front.
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

type PromptsModule = typeof import('@/server/data/prompts')

async function load(actor: Actor): Promise<PromptsModule> {
  current = actor.client

  vi.resetModules()
  vi.doMock('@/server/supabase', () => ({
    createServerSupabaseClient: async () => current,
  }))

  return import('@/server/data/prompts')
}

async function createActor(label: string): Promise<Actor> {
  const email = `prompts-${label}-${crypto.randomUUID()}@promptx.test`
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
async function seedPrompt(
  userId: string,
  overrides: { title: string; body?: string; tags?: string[]; updated_at?: string },
): Promise<string> {
  const { data, error } = await admin
    .from('prompts')
    .insert({ user_id: userId, body: 'Seeded body.', ...overrides })
    .select('id')
    .single()

  if (error) throw error
  return data.id
}

async function readRow(id: string) {
  const { data, error } = await admin
    .from('prompts')
    .select('title, body, tags, created_at, updated_at, user_id')
    .eq('id', id)
    .single()

  if (error) throw error
  return data
}

async function rowExists(id: string): Promise<boolean> {
  const { data, error } = await admin
    .from('prompts')
    .select('id')
    .eq('id', id)
    .maybeSingle()

  if (error) throw error
  return data !== null
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
      console.error('[tests/prompts] could not delete a fixture user', result.reason)
    }
  }
}, 30_000)

describeHosted('createPrompt', () => {
  it('stores the row and returns it', async () => {
    const data = await load(owner)

    const prompt = await data.createPrompt(owner.id, {
      title: 'Code review',
      body: 'Review this diff.',
      tags: ['code', 'review'],
    })

    expect(prompt.title).toBe('Code review')
    expect(prompt.tags).toEqual(['code', 'review'])

    const row = await readRow(prompt.id)
    expect(row.user_id).toBe(owner.id)
    expect(row.body).toBe('Review this diff.')
  })

  it('stores an empty tag array rather than null', async () => {
    // `tags` is `not null default '{}'`, and the filter reads `.includes()` on
    // it — a null would throw in the browser rather than mean "no tags".
    const data = await load(owner)
    const prompt = await data.createPrompt(owner.id, {
      title: 'Untagged',
      body: 'Body.',
      tags: [],
    })

    expect((await readRow(prompt.id)).tags).toEqual([])
  })
})

describeHosted('listPrompts', () => {
  it('returns only the caller’s prompts', async () => {
    const mine = await seedPrompt(owner.id, { title: 'Mine' })
    await seedPrompt(stranger.id, { title: 'Theirs' })

    const data = await load(owner)
    const prompts = await data.listPrompts()
    const ids = prompts.map((prompt) => prompt.id)

    expect(ids).toContain(mine)
    expect(prompts.every((prompt) => prompt.user_id === owner.id)).toBe(true)
  })

  it('orders most recently edited first', async () => {
    // Fixed timestamps rather than relying on insertion order, for the reason
    // F19's tie test had to be rewritten: an ordering assertion whose fixture
    // leaves the key to chance passes about half the time.
    const older = await seedPrompt(owner.id, {
      title: 'Older',
      updated_at: '2020-01-01T00:00:00.000Z',
    })
    const newer = await seedPrompt(owner.id, {
      title: 'Newer',
      updated_at: '2020-06-01T00:00:00.000Z',
    })

    const data = await load(owner)
    const ids = (await data.listPrompts()).map((prompt) => prompt.id)

    expect(ids.indexOf(newer)).toBeLessThan(ids.indexOf(older))
  })
})

describeHosted('updatePrompt', () => {
  const edit = { title: 'Edited', body: 'Edited body.', tags: ['edited'] }

  it('rewrites all three columns and returns the row', async () => {
    const data = await load(owner)
    const id = await seedPrompt(owner.id, { title: 'Before', tags: ['old'] })

    const updated = await data.updatePrompt(id, edit)

    expect(updated?.title).toBe('Edited')

    const row = await readRow(id)
    expect(row.body).toBe('Edited body.')
    expect(row.tags).toEqual(['edited'])
  })

  /**
   * The one place F24 departs from the rule four conversation writes follow,
   * and there is no trigger to hold it up. Verified by mutation: removing
   * `updated_at` from the statement turns this red and leaves the rest green,
   * while the grid silently stops reordering.
   */
  it('moves updated_at, because editing a prompt is the activity a prompt has', async () => {
    const data = await load(owner)
    const id = await seedPrompt(owner.id, {
      title: 'Steady',
      updated_at: '2020-01-01T00:00:00.000Z',
    })

    await data.updatePrompt(id, edit)

    const row = await readRow(id)
    expect(new Date(row.updated_at).getTime()).toBeGreaterThan(
      new Date('2020-01-01T00:00:00.000Z').getTime(),
    )
  })

  it('returns null for a prompt the caller does not own, and changes nothing', async () => {
    const id = await seedPrompt(owner.id, { title: 'Owner only', body: 'Untouched.' })
    const data = await load(stranger)

    expect(await data.updatePrompt(id, edit)).toBeNull()
    expect((await readRow(id)).body).toBe('Untouched.')
  })

  it('returns null for a prompt that does not exist', async () => {
    const data = await load(owner)

    expect(await data.updatePrompt(crypto.randomUUID(), edit)).toBeNull()
  })
})

describeHosted('deletePrompt', () => {
  it('deletes the row and reports that it went', async () => {
    const data = await load(owner)
    const id = await seedPrompt(owner.id, { title: 'Doomed' })

    expect(await data.deletePrompt(id)).toBe(true)
    expect(await rowExists(id)).toBe(false)
  })

  /**
   * The RLS no-op in its most dangerous form: a delete that matches nothing
   * reports no error, so without the row count coming back this would be
   * indistinguishable from success — and the route would answer 204 for someone
   * else's prompt that is still very much there.
   */
  it("returns false for another user's prompt, and leaves it alone", async () => {
    const id = await seedPrompt(owner.id, { title: 'Not yours' })
    const data = await load(stranger)

    expect(await data.deletePrompt(id)).toBe(false)
    expect(await rowExists(id)).toBe(true)
  })

  it('returns false for a prompt that does not exist', async () => {
    const data = await load(owner)

    expect(await data.deletePrompt(crypto.randomUUID())).toBe(false)
  })
})

/**
 * The read F25 added, exercised through the same JWT the route uses. (F25)
 *
 * `listPrompts()` already has coverage above; what is new here is that a *route*
 * now returns these rows to a browser, so the claim worth pinning is the one the
 * endpoint rests on entirely — that the cookie-bound client cannot see another
 * user's prompts. There is no `.eq('user_id')` anywhere in the path, by design:
 * the owner-read policy is the filter, and this is what says so out loud.
 */
describeHosted('the library as GET /api/prompts serves it', () => {
  it("never includes another user's prompt, with no user id passed anywhere", async () => {
    const mine = await seedPrompt(owner.id, { title: 'Mine to read' })
    const theirs = await seedPrompt(stranger.id, { title: 'Not mine to read' })

    const data = await load(owner)
    const ids = (await data.listPrompts()).map((prompt) => prompt.id)

    expect(ids).toContain(mine)
    expect(ids).not.toContain(theirs)
  })

  it('returns bodies, because insertion is what the picker does with them', async () => {
    // A lighter index would mean a second round trip at the moment of the click,
    // which is the one moment latency is visible. Pinned so a later payload
    // optimisation has to notice it is breaking the picker.
    const data = await load(owner)
    await data.createPrompt(owner.id, {
      title: 'Has a body',
      body: 'The body the composer inserts.',
      tags: [],
    })

    const prompts = await data.listPrompts()
    const saved = prompts.find((prompt) => prompt.title === 'Has a body')

    expect(saved?.body).toBe('The body the composer inserts.')
  })
})
