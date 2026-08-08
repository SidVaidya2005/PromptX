import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'

import { SHARED_KEY_DAILY_MESSAGE_LIMIT, SHARED_MODEL_ID } from '@/lib/constants'

import type { Database } from '@/types/database'

import { requiredEnv } from '../support/env'
import { describeHosted } from '../support/hosted'

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

/**
 * Puts the counters at known values, through the admin client.
 *
 * `compareCount` is F31's second counter — how many of today's claimed slots
 * will never be backed by a `messages` row. Defaulted to zero so every test
 * written before it existed still describes the same situation.
 */
async function setCount(count: number, compareCount = 0): Promise<void> {
  const { error } = await admin
    .from('shared_key_usage')
    .upsert(
      {
        user_id: user.id,
        usage_date: today(),
        message_count: count,
        compare_count: compareCount,
      },
      { onConflict: 'user_id,usage_date' },
    )

  if (error) throw new Error(`could not seed the counter: ${error.message}`)
}

async function readRow() {
  const { data, error } = await admin
    .from('shared_key_usage')
    .select('message_count, compare_count, input_tokens, output_tokens, updated_at')
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

/** What `/api/compare` claims: a slot that will leave no messages row. (F31) */
function reserveUnpersisted(actor: Actor = user) {
  return actor.client.rpc('reserve_shared_slot', {
    p_user_id: actor.id,
    p_limit: SHARED_KEY_DAILY_MESSAGE_LIMIT,
    p_persisted: false,
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

describeHosted('reserve_shared_slot', () => {
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

  it('leaves compare_count alone for a generation that will be persisted', async () => {
    // The default, and the half that would break the ordinary send path if it
    // ever moved: a chat message is counted once by its own row and would be
    // counted a second time by this column, so the sweep would raise nobody's
    // allowance but would refuse to lower a counter that should have come down.
    await reserve()

    const row = await readRow()
    expect(row?.message_count).toBe(1)
    expect(row?.compare_count).toBe(0)
  })

  it('counts an unpersisted claim on both counters, in one statement', async () => {
    // /api/compare's whole quota contract. message_count is what the limit is
    // tested against, so a comparison spends the same allowance a message does;
    // compare_count is the evidence the sweep needs, because there will be no
    // messages row for it to find.
    const { data, error } = await reserveUnpersisted()

    expect(error).toBeNull()
    expect(data).toBe(1)

    const row = await readRow()
    expect(row?.message_count).toBe(1)
    expect(row?.compare_count).toBe(1)
  })

  it('refuses an unpersisted claim at the same limit, without moving either counter', async () => {
    // A comparison is not a way around the cap. Both counters must hold still on
    // a refusal, or a spent allowance would still be accumulating evidence that
    // the sweep would later treat as slots to preserve.
    await setCount(SHARED_KEY_DAILY_MESSAGE_LIMIT)

    const refused = await reserveUnpersisted()
    expect(refused.data).toBeNull()

    const row = await readRow()
    expect(row?.message_count).toBe(SHARED_KEY_DAILY_MESSAGE_LIMIT)
    expect(row?.compare_count).toBe(0)
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

describeHosted('release_shared_slot', () => {
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

  it('lowers compare_count with the slot when the generation was never persisted', async () => {
    // A stopped comparison. The two counters have to fall together or the row is
    // left claiming evidence for a slot message_count no longer holds — and the
    // sweep, which only ever lowers message_count, would never correct it.
    await setCount(3, 2)

    await user.client.rpc('release_shared_slot', {
      p_user_id: user.id,
      p_persisted: false,
    })

    const row = await readRow()
    expect(row?.message_count).toBe(2)
    expect(row?.compare_count).toBe(1)
  })

  it('floors compare_count at zero too', async () => {
    // /api/compare reaches onAbort and onError for one request just as /api/chat
    // does, so the double release is the same real path. A negative here would
    // make the sweep's `actual` smaller than the truth and refund a live slot.
    await setCount(1, 1)

    await user.client.rpc('release_shared_slot', { p_user_id: user.id, p_persisted: false })
    await user.client.rpc('release_shared_slot', { p_user_id: user.id, p_persisted: false })

    const row = await readRow()
    expect(row?.message_count).toBe(0)
    expect(row?.compare_count).toBe(0)
  })

  it('leaves compare_count alone when refunding an ordinary message', async () => {
    // The mismatch that would be silent: releasing a chat slot must not consume
    // a comparison's evidence, or the next sweep hands that comparison's slot
    // back and the daily cap quietly stops applying to it.
    await setCount(3, 1)

    await user.client.rpc('release_shared_slot', { p_user_id: user.id })

    const row = await readRow()
    expect(row?.message_count).toBe(2)
    expect(row?.compare_count).toBe(1)
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

describeHosted('record_shared_tokens', () => {
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

describeHosted('reconcile_shared_key_usage', () => {
  /**
   * The self-healing half of the reservation bargain, shipped at F02 and
   * running on pg_cron every ten minutes ever since — against a database that
   * had no reservations to correct until F16, and no orphan since. Its runs
   * report "succeeded", which only means it executed; nothing had ever watched
   * it lower a counter.
   *
   * Called through the admin client because execute is revoked from
   * `authenticated`: pg_cron invokes it as the table owner, and nobody should
   * be able to sweep their own allowance by hand.
   */

  /** Ages the row past the five-minute staleness bound the sweep uses. */
  async function ageRow(minutes: number) {
    const { error } = await admin
      .from('shared_key_usage')
      .update({ updated_at: new Date(Date.now() - minutes * 60_000).toISOString() })
      .eq('user_id', user.id)
      .eq('usage_date', today())

    if (error) throw new Error(`could not age the row: ${error.message}`)
  }

  it('releases a reservation whose generation never arrived', async () => {
    // The orphan this exists for: a process that died between reserving the
    // slot and running onError, leaving a claim for a message the user never
    // received. `messages` is the source of truth and holds nothing here.
    await setCount(3)
    await ageRow(10)

    await admin.rpc('reconcile_shared_key_usage')

    expect((await readRow())?.message_count).toBe(0)
  })

  it('leaves a reservation younger than the staleness window alone', async () => {
    // Without this guard the sweep races live requests and hands out slots that
    // are genuinely in use. setCount leaves updated_at at now().
    await setCount(3)

    await admin.rpc('reconcile_shared_key_usage')

    expect((await readRow())?.message_count).toBe(3)
  })

  it('does not refund a comparison, which leaves no message row to find', async () => {
    /**
     * **The defect this counter exists to prevent.** (F31)
     *
     * The sweep reconciles `message_count` against `messages`, and a comparison
     * persists nothing — so before `compare_count` existed, both slots a
     * comparison claimed came back within ten minutes and `/compare` obeyed no
     * daily cap at all: two generations per click, unbounded, with only the
     * global monthly breaker between a user and the shared key.
     *
     * Seeded through the function rather than with setCount, so what is being
     * tested is the pair of writes the route actually makes.
     */
    await reserveUnpersisted()
    await reserveUnpersisted()
    await ageRow(10)

    await admin.rpc('reconcile_shared_key_usage')

    const row = await readRow()
    expect(row?.message_count).toBe(2)
    expect(row?.compare_count).toBe(2)
  })

  it('does not let a promoted comparison block a refund it should have made', async () => {
    /**
     * **The arithmetic behind F32's `used_shared_key: false`.**
     *
     * Promoting writes the chosen answer as an assistant row, and the shared key
     * really did produce it — but F31 already recorded that spend in
     * `compare_count`. Marking the row `true` would count one generation twice,
     * raising `actual`; and because the sweep only ever *lowers*, the inflated
     * floor keeps an unrelated orphaned slot claimed. The user is then charged
     * for a generation they never received, ten minutes after the fact, with
     * nothing on screen to say so.
     *
     * Here: one comparison (claimed and promoted) plus one slot orphaned by a
     * dead process. `actual` must be 1 — the comparison — so the orphan comes
     * back.
     */
    const conversationId = await seedDeliveredSharedMessage('complete', 0, false)

    try {
      await setCount(2, 1)
      await ageRow(10)

      await admin.rpc('reconcile_shared_key_usage')

      expect((await readRow())?.message_count).toBe(1)
    } finally {
      await admin.from('conversations').delete().eq('id', conversationId)
    }
  })

  it('reconciles a mixed day down to the messages plus the comparisons', async () => {
    // The case that separates "counts comparisons" from "gave up and stopped
    // reconciling". One delivered message, one comparison, and two slots that
    // are genuine orphans — the sweep must still take those two back.
    const conversationId = await seedDeliveredSharedMessage()

    try {
      await setCount(4, 1)
      await ageRow(10)

      await admin.rpc('reconcile_shared_key_usage')

      // 1 delivered message + 1 comparison. The other two were orphans.
      expect((await readRow())?.message_count).toBe(2)
    } finally {
      await admin.from('conversations').delete().eq('id', conversationId)
    }
  })

  it('only ever lowers, so it cannot charge for what the reservation missed', async () => {
    // A delivered message with no matching reservation makes `actual` exceed
    // the counter. The sweep's `message_count > actual` clause must decline to
    // correct upward — a job that could raise this would bill people for
    // generations the reserve path already failed to charge for.
    const conversationId = await seedDeliveredSharedMessage()

    try {
      await setCount(0)
      await ageRow(10)

      await admin.rpc('reconcile_shared_key_usage')

      expect((await readRow())?.message_count).toBe(0)
    } finally {
      await admin.from('conversations').delete().eq('id', conversationId)
    }
  })

  it('retires an assistant row abandoned mid-stream', async () => {
    // The second artefact a dead process leaves, and the user-visible one: a
    // row stuck in `streaming` renders as a message that loads forever.
    const conversationId = await seedDeliveredSharedMessage('streaming', 10)

    try {
      await admin.rpc('reconcile_shared_key_usage')

      const { data } = await admin
        .from('messages')
        .select('status, error_message')
        .eq('conversation_id', conversationId)
        .single()

      expect(data?.status).toBe('error')
      expect(data?.error_message).toBe('Generation was interrupted')
    } finally {
      await admin.from('conversations').delete().eq('id', conversationId)
    }
  })

  /** A conversation with one shared-key assistant message. Returns its id. */
  async function seedDeliveredSharedMessage(
    status: 'complete' | 'streaming' = 'complete',
    ageMinutes = 0,
    /**
     * False seeds a PROMOTED row — F32's copy of a comparison's answer, written
     * with `used_shared_key: false` because F31 already counted that spend in
     * `compare_count`. The sweep must not see it as evidence of a second one.
     */
    usedSharedKey = true,
  ): Promise<string> {
    const { data: conversation, error: conversationError } = await admin
      .from('conversations')
      .insert({
        user_id: user.id,
        provider: 'google',
        model_id: SHARED_MODEL_ID,
      })
      .select('id')
      .single()

    if (conversationError || !conversation) {
      throw new Error(`could not seed a conversation: ${conversationError?.message}`)
    }

    const { error: messageError } = await admin.from('messages').insert({
      conversation_id: conversation.id,
      user_id: user.id,
      role: 'assistant',
      content: 'seeded',
      status,
      used_shared_key: usedSharedKey,
      provider: 'google',
      model_id: SHARED_MODEL_ID,
      created_at: new Date(Date.now() - ageMinutes * 60_000).toISOString(),
    })

    if (messageError) throw new Error(`could not seed a message: ${messageError.message}`)

    return conversation.id
  }
})
