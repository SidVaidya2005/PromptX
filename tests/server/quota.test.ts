import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { SHARED_KEY_DAILY_MESSAGE_LIMIT } from '@/lib/constants'

import type { Database } from '@/types/database'

import { requiredEnv } from '../support/env'

/**
 * The quota functions, against the real database.
 *
 * Not mockable, and the reason is the whole feature: `reserve_shared_slot`
 * claims a slot in a single conditional upsert, and its correctness is a
 * property of how Postgres serialises concurrent updates on one row. A fake
 * would answer whatever it was told to and prove nothing.
 *
 * Every call goes through a SIGNED-IN publishable-key client, never the
 * service-role one. These functions are `security invoker`, so they run under
 * the caller's session and inherit the owner policy on `shared_key_usage` —
 * calling them as service role would bypass the very thing that stops one user
 * spending another's allowance, and the suite would pass while the policy was
 * broken. Fixtures are still seeded and inspected with the admin client, for the
 * reason tests/rls/isolation.test.ts gives: seeding through the policies under
 * test lets a broken one leave the table empty and every assertion pass for the
 * wrong reason.
 */

const SUPABASE_URL = requiredEnv('NEXT_PUBLIC_SUPABASE_URL')
const PUBLISHABLE_KEY = requiredEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY')
const SECRET_KEY = requiredEnv('SUPABASE_SECRET_KEY')

const admin = createClient<Database>(SUPABASE_URL, SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

type Actor = { id: string; client: SupabaseClient<Database> }

let user: Actor

/** The UTC calendar day, which is what usage_date stores. */
const today = () => new Date().toISOString().slice(0, 10)

async function createActor(): Promise<Actor> {
  const email = `quota-${crypto.randomUUID()}@promptx.test`
  const password = crypto.randomUUID()

  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })

  if (error || !created.user) throw new Error(`could not create user: ${error?.message}`)

  const client = createClient<Database>(SUPABASE_URL, PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { error: signInError } = await client.auth.signInWithPassword({ email, password })
  if (signInError) throw new Error(`could not sign in: ${signInError.message}`)

  return { id: created.user.id, client }
}

/** Puts the counter at a known value, through the admin client. */
async function setCount(count: number): Promise<void> {
  const { error } = await admin
    .from('shared_key_usage')
    .upsert(
      { user_id: user.id, usage_date: today(), message_count: count },
      { onConflict: 'user_id,usage_date' },
    )

  if (error) throw new Error(`could not seed the counter: ${error.message}`)
}

async function readRow() {
  const { data, error } = await admin
    .from('shared_key_usage')
    .select('message_count, input_tokens, output_tokens, updated_at')
    .eq('user_id', user.id)
    .eq('usage_date', today())
    .maybeSingle()

  if (error) throw new Error(`could not read the counter: ${error.message}`)
  return data
}

function reserve(actor: Actor = user) {
  return actor.client.rpc('reserve_shared_slot', {
    p_user_id: actor.id,
    p_limit: SHARED_KEY_DAILY_MESSAGE_LIMIT,
  })
}

beforeAll(async () => {
  user = await createActor()
})

afterAll(async () => {
  // The cascade on auth.users clears shared_key_usage with it.
  if (user?.id) await admin.auth.admin.deleteUser(user.id)
})

beforeEach(async () => {
  await admin
    .from('shared_key_usage')
    .delete()
    .eq('user_id', user.id)
    .eq('usage_date', today())
})

describe('reserve_shared_slot', () => {
  it('claims the first slot of the day by creating the row', async () => {
    const { data, error } = await reserve()

    expect(error).toBeNull()
    expect(data).toBe(1)
  })

  it('grants the last message of the allowance and refuses the next', async () => {
    // The boundary named in project-overview.md: the 20th succeeds, the 21st
    // does not. Seeded one short so this asserts the transition rather than
    // twenty round trips.
    await setCount(SHARED_KEY_DAILY_MESSAGE_LIMIT - 1)

    const granted = await reserve()
    expect(granted.error).toBeNull()
    expect(granted.data).toBe(SHARED_KEY_DAILY_MESSAGE_LIMIT)

    const refused = await reserve()
    // No row, not an error. PostgREST renders a zero-row `returns integer` as
    // null, and quota.ts maps exactly that to QuotaExceededError.
    expect(refused.error).toBeNull()
    expect(refused.data).toBeNull()
  })

  it('does not move the counter when it refuses', async () => {
    await setCount(SHARED_KEY_DAILY_MESSAGE_LIMIT)

    await reserve()

    expect((await readRow())?.message_count).toBe(SHARED_KEY_DAILY_MESSAGE_LIMIT)
  })

  it('issues one grant when ten attempts are dispatched at once', async () => {
    // Read the name carefully: dispatched at once, not EXECUTED at once. This
    // does not prove the race is closed, and saying otherwise would be the more
    // dangerous kind of green test.
    //
    // build-plan.md §16 asks for a concurrency test, and it cannot be honoured
    // against this project. Measured rather than assumed: the reserve function
    // was temporarily rewritten as a read-then-write with a one-second sleep
    // wedged between the read and the write — an implementation that MUST
    // over-issue under any real overlap — and this test stayed green. Timing
    // showed why. Ten calls each sleeping a second took eleven seconds, so they
    // ran one after another; three further rounds of six parallel calls took
    // ~6.8s each, the same. Requests to the hosted project serialise, through
    // both a signed-in publishable client and a raw fetch, so there is no window
    // for a second statement to land inside.
    //
    // What still holds the invariant is the implementation's shape rather than
    // this assertion: `reserve_shared_slot` is a single SQL statement, which
    // cannot read-then-write, with the limit check on the `do update` branch.
    // Confirmed in the database, not just in the migration file:
    //   select pg_get_functiondef(oid) ... like '%where ... message_count < p_limit%'
    // returns true for reserve_shared_slot and language 'sql', not plpgsql.
    //
    // This is kept because it would still catch a flagrant regression — a guard
    // dropped entirely, a limit read from the wrong place — and because the
    // boundary above is genuinely exercised. Proving atomicity needs two real
    // sessions overlapping: a local stack, or F36's e2e run.
    await setCount(SHARED_KEY_DAILY_MESSAGE_LIMIT - 1)

    const attempts = await Promise.all(Array.from({ length: 10 }, () => reserve()))

    const granted = attempts.filter((attempt) => attempt.data !== null)

    expect(granted).toHaveLength(1)
    expect((await readRow())?.message_count).toBe(SHARED_KEY_DAILY_MESSAGE_LIMIT)
  })

  it('touches updated_at, which the reconciliation sweep depends on', async () => {
    // Load-bearing rather than bookkeeping: the sweep treats a row untouched for
    // five minutes as holding an orphaned reservation. A function that leaves
    // this frozen makes every row look stale and starts releasing live slots.
    await setCount(1)
    const stale = new Date(Date.now() - 60_000).toISOString()
    await admin
      .from('shared_key_usage')
      .update({ updated_at: stale })
      .eq('user_id', user.id)
      .eq('usage_date', today())

    await reserve()

    expect(new Date((await readRow())!.updated_at).getTime()).toBeGreaterThan(
      new Date(stale).getTime(),
    )
  })

  it('cannot be used to spend somebody else’s allowance', async () => {
    // security invoker means the owner policy applies. Passing another user's id
    // must write nothing — the insert is filtered, not merely ignored.
    const other = await createActor()

    try {
      await user.client.rpc('reserve_shared_slot', {
        p_user_id: other.id,
        p_limit: SHARED_KEY_DAILY_MESSAGE_LIMIT,
      })

      const { data } = await admin
        .from('shared_key_usage')
        .select('message_count')
        .eq('user_id', other.id)
        .eq('usage_date', today())
        .maybeSingle()

      expect(data).toBeNull()
    } finally {
      await admin.auth.admin.deleteUser(other.id)
    }
  })
})

describe('release_shared_slot', () => {
  it('refunds exactly one slot', async () => {
    await setCount(5)

    await user.client.rpc('release_shared_slot', { p_user_id: user.id })

    expect((await readRow())?.message_count).toBe(4)
  })

  it('cannot drive the counter below zero', async () => {
    // onError and onAbort can both be reached for one request, so a double
    // release is a real path rather than a hypothetical. Without the floor it
    // would hand out a free message.
    await setCount(1)

    await user.client.rpc('release_shared_slot', { p_user_id: user.id })
    await user.client.rpc('release_shared_slot', { p_user_id: user.id })

    expect((await readRow())?.message_count).toBe(0)
  })

  it('touches updated_at', async () => {
    await setCount(3)
    const stale = new Date(Date.now() - 60_000).toISOString()
    await admin
      .from('shared_key_usage')
      .update({ updated_at: stale })
      .eq('user_id', user.id)
      .eq('usage_date', today())

    await user.client.rpc('release_shared_slot', { p_user_id: user.id })

    expect(new Date((await readRow())!.updated_at).getTime()).toBeGreaterThan(
      new Date(stale).getTime(),
    )
  })
})

describe('record_shared_tokens', () => {
  it('accumulates rather than overwrites', async () => {
    await setCount(1)

    await user.client.rpc('record_shared_tokens', {
      p_user_id: user.id,
      p_input_tokens: 10,
      p_output_tokens: 20,
    })
    await user.client.rpc('record_shared_tokens', {
      p_user_id: user.id,
      p_input_tokens: 5,
      p_output_tokens: 7,
    })

    const row = await readRow()
    expect(row?.input_tokens).toBe(15)
    expect(row?.output_tokens).toBe(27)
  })

  it('never changes the message count', async () => {
    // Accounting, never enforcement. Tokens must not be able to spend a slot.
    await setCount(4)

    await user.client.rpc('record_shared_tokens', {
      p_user_id: user.id,
      p_input_tokens: 999_999,
      p_output_tokens: 999_999,
    })

    expect((await readRow())?.message_count).toBe(4)
  })
})
