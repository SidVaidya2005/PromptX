import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'

import { getTodaysUsage } from '@/server/data/shared-key-usage'

import type { Database } from '@/types/database'

import { requiredEnv } from '../support/env'
import { describeHosted } from '../support/hosted'

/**
 * The read half of the daily allowance — what the composer's meter and
 * `/settings/keys` display.
 *
 * `quota.test.ts` covers the writes, which are Postgres functions because the
 * check and the increment must be one statement. What is left here is a plain
 * select, and it has two properties worth holding: it is scoped by the owner
 * policy rather than by a `user_id` filter, and it agrees with
 * `reserve_shared_slot` about which day it is. The second is the quiet one — the
 * date is computed in TypeScript rather than in Postgres, so a disagreement
 * would show a user an allowance that does not match what the server enforces,
 * for a few hours either side of midnight UTC.
 *
 * The module runs for real with only the cookie-bound client swapped, so the
 * policy is genuinely in the path.
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
let sessionClient: SupabaseClient<Database>

vi.mock('@/server/supabase', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/supabase')>()),
  createServerSupabaseClient: async () => sessionClient,
}))

/** The same UTC calendar day the module and `reserve_shared_slot` both use. */
function utcToday(): string {
  return new Date().toISOString().slice(0, 10)
}

function utcDaysAgo(days: number): string {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() - days)
  return date.toISOString().slice(0, 10)
}

async function setUsage(userId: string, usageDate: string, count: number) {
  const { error } = await admin
    .from('shared_key_usage')
    .upsert(
      { user_id: userId, usage_date: usageDate, message_count: count },
      { onConflict: 'user_id,usage_date' },
    )

  if (error) throw error
}

async function clearUsage(userId: string) {
  const { error } = await admin
    .from('shared_key_usage')
    .delete()
    .eq('user_id', userId)

  if (error) throw error
}

async function createActor(label: string): Promise<Actor> {
  const email = `usage-${label}-${crypto.randomUUID()}@promptx.test`
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
  ;[owner, stranger] = await Promise.all([
    createActor('owner'),
    createActor('stranger'),
  ])
}, 30_000)

beforeEach(async () => {
  sessionClient = owner.client
  await Promise.all([clearUsage(owner.id), clearUsage(stranger.id)])
})

afterAll(async () => {
  const results = await Promise.allSettled(
    [owner, stranger]
      .filter((actor): actor is Actor => actor !== undefined)
      .map((actor) => admin.auth.admin.deleteUser(actor.id)),
  )

  for (const result of results) {
    if (result.status === 'rejected') {
      console.error('[tests/shared-key-usage] could not delete a fixture user', result.reason)
    }
  }
}, 30_000)

describeHosted('getTodaysUsage', () => {
  it('reports an untouched allowance as zero rather than as missing data', async () => {
    // No row exists until the first reservation of the day, so absence is a
    // full allowance — not something to distinguish from a real zero.
    expect(await getTodaysUsage()).toBe(0)
  })

  it('reports what today’s row actually holds', async () => {
    await setUsage(owner.id, utcToday(), 7)

    expect(await getTodaysUsage()).toBe(7)
  })

  it('reads today’s row and not yesterday’s', async () => {
    // The allowance resets at 00:00 UTC by the row rolling over, not by anything
    // clearing it — so a read that ignored the date would carry yesterday's
    // count into today and show a wall that is not there.
    await setUsage(owner.id, utcDaysAgo(1), 20)

    expect(await getTodaysUsage()).toBe(0)
  })

  it('never reads another user’s allowance, with no user id passed anywhere', async () => {
    // The function takes no arguments. The owner policy is the only thing
    // scoping it, so a stranger sitting at the daily limit must be invisible
    // rather than merely filtered out.
    await setUsage(stranger.id, utcToday(), 20)
    await setUsage(owner.id, utcToday(), 3)

    expect(await getTodaysUsage()).toBe(3)

    sessionClient = stranger.client
    expect(await getTodaysUsage()).toBe(20)
  })
})
