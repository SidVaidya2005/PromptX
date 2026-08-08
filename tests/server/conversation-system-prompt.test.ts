import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'

import type { Database } from '@/types/database'

import { requiredEnv } from '../support/env'
import { describeHosted } from '../support/hosted'

/**
 * The per-conversation system prompt, proven against the real hosted project.
 * (F23)
 *
 * One nullable text column, so the write is not what is interesting. Three
 * things around it are:
 *
 * - **Null is a value, not "no change".** It is how a prompt is cleared, and a
 *   function that treated it as absent would leave the old instruction standing
 *   while the UI showed "Default" — the worst possible disagreement, because
 *   every later answer would follow a rule the user believes they removed.
 * - **It reports success for a row it never touched.** The RLS no-op that every
 *   write in this file has to distinguish.
 * - **`createConversation()` is the only path that may accept one from a
 *   request body**, so it has to actually persist it — otherwise a prompt set
 *   on `/chat` is silently dropped at the moment the conversation is born.
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
  const email = `sysprompt-${label}-${crypto.randomUUID()}@promptx.test`
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
  overrides: { title: string; system_prompt?: string },
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
    .select('title, system_prompt, pinned_at, updated_at')
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
        '[tests/conversation-system-prompt] could not delete a fixture user',
        result.reason,
      )
    }
  }
}, 30_000)

describeHosted('updateSystemPrompt', () => {
  it('sets a prompt and reports that a row changed', async () => {
    const data = await load(owner)
    const id = await seedConversation(owner.id, { title: 'Instructed' })

    expect(await data.updateSystemPrompt(id, 'Answer in French.')).toBe(true)
    expect((await readRow(id)).system_prompt).toBe('Answer in French.')
  })

  /**
   * Null is the clear, and the reason this gets its own test rather than being
   * an assertion inside the one above: a function that treated null as "no
   * change" would pass every other test in this file while leaving a removed
   * instruction quietly in force.
   */
  it('clears a stored prompt when given null', async () => {
    const data = await load(owner)
    const id = await seedConversation(owner.id, {
      title: 'Instructed',
      system_prompt: 'Answer in French.',
    })

    expect(await data.updateSystemPrompt(id, null)).toBe(true)
    expect((await readRow(id)).system_prompt).toBeNull()
  })

  it("returns false for a conversation the caller does not own, and changes nothing", async () => {
    const id = await seedConversation(owner.id, {
      title: 'Owner only',
      system_prompt: 'Answer in French.',
    })
    const data = await load(stranger)

    expect(await data.updateSystemPrompt(id, 'Answer in German.')).toBe(false)
    expect((await readRow(id)).system_prompt).toBe('Answer in French.')
  })

  /**
   * Verified by mutation: adding `updated_at: new Date().toISOString()` to the
   * update turns this red. The fourth feature running to hold this line —
   * changing how a conversation will answer is not activity in it.
   */
  it('leaves updated_at alone', async () => {
    const data = await load(owner)
    const id = await seedConversation(owner.id, { title: 'Steady' })
    const before = await readRow(id)

    await data.updateSystemPrompt(id, 'Answer in French.')

    expect((await readRow(id)).updated_at).toBe(before.updated_at)
  })
})

/**
 * The creation path is the ONLY one allowed to take a system prompt from a
 * request body, because on `/chat` there is no row to have stored one.
 *
 * That makes these two the pair that matters: it must persist what it is given,
 * and it must default to null rather than to anything else — a conversation
 * created without a prompt has to be indistinguishable from one that never had
 * one, or "Default" would stop meaning what the control says it means.
 */
describeHosted('createConversation with a system prompt', () => {
  const model = { provider: 'google' as const, modelId: 'gemini-3.6-flash' }

  it('persists a prompt passed at creation', async () => {
    const data = await load(owner)
    const id = await data.createConversation(owner.id, model, 'Answer in French.')

    expect((await readRow(id)).system_prompt).toBe('Answer in French.')
  })

  it('stores null when none is given, without the caller saying so', async () => {
    const data = await load(owner)
    const id = await data.createConversation(owner.id, model)

    expect((await readRow(id)).system_prompt).toBeNull()
  })
})
