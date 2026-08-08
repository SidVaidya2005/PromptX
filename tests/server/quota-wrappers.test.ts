import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'

import { releaseSharedSlot } from '@/server/quota'

import type { Database } from '@/types/database'

import { requiredEnv } from '../support/env'
import { describeHosted } from '../support/hosted'

/**
 * The two quota wrappers nothing had ever called.
 *
 * `quota.test.ts` proves the Postgres functions — the atomic claim, the floor at
 * zero, the compare counter, the staleness guard — by invoking them over RPC
 * directly. That is the right place for them, because atomicity is a property of
 * Postgres and a mock cannot have it. But it leaves the TypeScript above them
 * unexercised, and a wrapper is exactly where a silent mismatch lives: F13's
 * `bytea` corruption was a wrapper passing the wrong shape, reporting success,
 * and surfacing only when something later tried to decrypt.
 *
 * The specific risk here is an argument name. `p_user_id`, `p_persisted`,
 * `p_input_tokens` are strings in TypeScript and parameters in SQL, and nothing
 * checks that they still match — a rename on either side compiles, runs, and
 * quietly does nothing to anybody's allowance.
 *
 * Both functions also **swallow their errors on purpose**, which doubles the
 * cost of getting this wrong. A refund that fails must not turn a working
 * generation into a failed request, and accounting that fails must not either —
 * so neither throws, and a broken call is invisible without a test that reads
 * the row afterwards.
 *
 * **`recordSharedKeyTokens` is deliberately NOT here**, even though it is the
 * other untested wrapper. It forwards to `recordSharedBudgetTokens()`, so it
 * writes the global singleton — and Vitest runs test files in parallel, so a
 * second file mutating that row races `budget.test.ts` no matter how carefully
 * each one restores. Measured, not predicted: both suites went red together with
 * `expected 10814 to be 420`. Exactly one file may write `shared_key_budget`,
 * and that file is `budget.test.ts`, which is where those tests live.
 */

const SUPABASE_URL = requiredEnv('NEXT_PUBLIC_SUPABASE_URL')
const PUBLISHABLE_KEY = requiredEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY')
const SECRET_KEY = requiredEnv('SUPABASE_SECRET_KEY')

const admin = createClient<Database>(SUPABASE_URL, SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

type Actor = { id: string; client: SupabaseClient<Database> }

let owner: Actor
let sessionClient: SupabaseClient<Database>

vi.mock('@/server/supabase', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/supabase')>()),
  createServerSupabaseClient: async () => sessionClient,
}))

function utcToday(): string {
  return new Date().toISOString().slice(0, 10)
}

async function setUsage(
  userId: string,
  patch: { message_count?: number; compare_count?: number; input_tokens?: number; output_tokens?: number },
) {
  const { error } = await admin.from('shared_key_usage').upsert(
    {
      user_id: userId,
      usage_date: utcToday(),
      message_count: patch.message_count ?? 0,
      compare_count: patch.compare_count ?? 0,
      input_tokens: patch.input_tokens ?? 0,
      output_tokens: patch.output_tokens ?? 0,
    },
    { onConflict: 'user_id,usage_date' },
  )

  if (error) throw error
}

async function readUsage(userId: string) {
  const { data, error } = await admin
    .from('shared_key_usage')
    .select('*')
    .eq('user_id', userId)
    .eq('usage_date', utcToday())
    .maybeSingle()

  if (error) throw error
  return data
}

beforeAll(async () => {
  const email = `quota-wrap-${crypto.randomUUID()}@promptx.test`
  const password = crypto.randomUUID()

  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (error || !created.user) throw new Error(`could not create owner: ${error?.message}`)

  const client = createClient<Database>(SUPABASE_URL, PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error: signInError } = await client.auth.signInWithPassword({ email, password })
  if (signInError) throw new Error(`could not sign in owner: ${signInError.message}`)

  owner = { id: created.user.id, client }

}, 30_000)

beforeEach(() => {
  sessionClient = owner.client
})

afterAll(async () => {
  const result = await admin.auth.admin.deleteUser(owner.id)
  if (result.error) {
    console.error('[tests/quota-wrappers] could not delete the fixture user', result.error)
  }
}, 30_000)

describeHosted('releaseSharedSlot', () => {
  it('refunds exactly one message slot', async () => {
    await setUsage(owner.id, { message_count: 5 })

    await releaseSharedSlot(owner.id)

    expect((await readUsage(owner.id))?.message_count).toBe(4)
  })

  it('lowers the compare counter too when the generation was never persisted', async () => {
    // A comparison spends the key and writes no message row, so the sweep cannot
    // see it — the second counter is what stops /compare escaping the daily cap.
    // A wrapper that dropped `p_persisted` would refund the message count and
    // leave the compare count high, quietly narrowing the allowance. (F31)
    await setUsage(owner.id, { message_count: 3, compare_count: 3 })

    await releaseSharedSlot(owner.id, { persisted: false })

    const usage = await readUsage(owner.id)
    expect(usage?.message_count).toBe(2)
    expect(usage?.compare_count).toBe(2)
  })

  it('leaves the compare counter alone when refunding an ordinary message', async () => {
    await setUsage(owner.id, { message_count: 3, compare_count: 2 })

    await releaseSharedSlot(owner.id)

    const usage = await readUsage(owner.id)
    expect(usage?.message_count).toBe(2)
    expect(usage?.compare_count).toBe(2)
  })

  it('touches updated_at, which the reconciliation sweep depends on', async () => {
    // The staleness guard is what stops the sweep racing live requests. A quota
    // function that forgets this column leaves it frozen at its insert value,
    // every row then looks stale, and the sweep starts releasing reservations
    // that are genuinely in use.
    await setUsage(owner.id, { message_count: 2 })
    await admin
      .from('shared_key_usage')
      .update({ updated_at: '2025-01-01T00:00:00.000Z' })
      .eq('user_id', owner.id)
      .eq('usage_date', utcToday())

    await releaseSharedSlot(owner.id)

    const usage = await readUsage(owner.id)
    expect(new Date(usage?.updated_at ?? 0).getTime()).toBeGreaterThan(
      new Date('2025-01-01T00:00:00.000Z').getTime(),
    )
  })

  it('does not throw when there is nothing to refund', async () => {
    // Swallowing is deliberate: a failed refund must never turn a generation the
    // user actually received into a failed request.
    await expect(releaseSharedSlot(owner.id)).resolves.toBeUndefined()
  })
})
