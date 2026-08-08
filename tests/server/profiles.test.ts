import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'

import { getProfile } from '@/server/data/profiles'

import type { Database } from '@/types/database'

import { requiredEnv } from '../support/env'
import { describeHosted } from '../support/hosted'

/**
 * `getProfile()` is four lines and carries no `.eq('id', …)` at all, which is the
 * whole reason it needs a real session to test. Its isolation comes from the
 * owner policy and from nowhere else, so a mocked client would assert that
 * supabase-js can select a row rather than that this function is safe.
 *
 * The module is therefore run for real, with only the cookie-bound client
 * replaced — the same narrow substitution `budget.test.ts` makes, and for the
 * same reason: the real factory calls `cookies()` from next/headers, which throws
 * outside a request scope. Everything below that swap is genuine: a real JWT, a
 * real round trip, real policies.
 *
 * There is a second property here that reads like a detail and is not.
 * `.maybeSingle()` **errors** when more than one row comes back, so a broken
 * owner policy does not leak somebody else's profile through this function — it
 * throws. That is failing closed by construction, and it is worth pinning
 * because the obvious "hardening" of adding a `.eq('id', userId)` would silently
 * convert it into failing open.
 */

const SUPABASE_URL = requiredEnv('NEXT_PUBLIC_SUPABASE_URL')
const PUBLISHABLE_KEY = requiredEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY')
const SECRET_KEY = requiredEnv('SUPABASE_SECRET_KEY')

const admin = createClient<Database>(SUPABASE_URL, SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

type Actor = {
  id: string
  email: string
  client: SupabaseClient<Database>
}

let owner: Actor
let stranger: Actor

/** Whichever session the module should read through for the current test. */
let sessionClient: SupabaseClient<Database>

vi.mock('@/server/supabase', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/supabase')>()),
  createServerSupabaseClient: async () => sessionClient,
}))

async function createActor(label: string): Promise<Actor> {
  const email = `profiles-${label}-${crypto.randomUUID()}@promptx.test`
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

  return { id: created.user.id, email, client }
}

beforeAll(async () => {
  ;[owner, stranger] = await Promise.all([
    createActor('owner'),
    createActor('stranger'),
  ])
}, 30_000)

afterAll(async () => {
  const results = await Promise.allSettled(
    [owner, stranger]
      .filter((actor): actor is Actor => actor !== undefined)
      .map((actor) => admin.auth.admin.deleteUser(actor.id)),
  )

  for (const result of results) {
    if (result.status === 'rejected') {
      console.error('[tests/profiles] could not delete a fixture user', result.reason)
    }
  }
}, 30_000)

describeHosted('getProfile', () => {
  it('returns the caller’s own row, created by the signup trigger', async () => {
    sessionClient = owner.client

    const profile = await getProfile()

    expect(profile).not.toBeNull()
    expect(profile?.id).toBe(owner.id)
    expect(profile?.email).toBe(owner.email)
  })

  it('returns a different row for a different session, with no id passed anywhere', async () => {
    // The function takes no arguments at all. If the policy were not doing the
    // scoping, these two calls could not differ — which is what makes this the
    // assertion that matters rather than the one above.
    sessionClient = owner.client
    const first = await getProfile()

    sessionClient = stranger.client
    const second = await getProfile()

    expect(first?.id).toBe(owner.id)
    expect(second?.id).toBe(stranger.id)
    expect(first?.id).not.toBe(second?.id)
  })

  it('never returns a row belonging to the other user', async () => {
    sessionClient = owner.client

    const profile = await getProfile()

    expect(profile?.id).not.toBe(stranger.id)
    expect(profile?.email).not.toBe(stranger.email)
  })
})
