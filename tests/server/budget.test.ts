import { createClient } from '@supabase/supabase-js'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from 'vitest'

import {
  SHARED_KEY_INPUT_USD_PER_MILLION,
  SHARED_KEY_MONTHLY_USD_CEILING,
  SHARED_KEY_OUTPUT_USD_PER_MILLION,
} from '@/lib/constants'

import {
  BudgetExhaustedError,
  isSharedKeyAvailable,
  recordSharedBudgetTokens,
  reserveSharedSlot,
} from '@/server/quota'
import { createServerSupabaseClient } from '@/server/supabase'

import type { Database } from '@/types/database'

import { requiredEnv } from '../support/env'
import { describeHosted } from '../support/hosted'

/**
 * Only the cookie-bound half is replaced; `createServiceRoleClient` stays real,
 * because every other test in this file needs it to reach a table that has no
 * RLS policy. The reason for replacing this one at all is narrow: the real
 * factory calls `cookies()` from next/headers, which throws outside a request,
 * and the ordering asserted in "the breaker comes first" is a property of
 * reserveSharedSlot's TypeScript rather than of any SQL.
 */
vi.mock('@/server/supabase', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/supabase')>()),
  createServerSupabaseClient: vi.fn(),
}))

/**
 * The global monthly ceiling, against the real database.
 *
 * Unlike `quota.test.ts`, this suite imports the TypeScript wrappers and calls
 * them directly. It can, because both reach `shared_key_budget` through the
 * service-role client alone and never touch `next/headers` — so the rate card,
 * the ceiling constant and the measured-usage guard are all inside what is being
 * tested, rather than reimplemented by the test.
 *
 * **`shared_key_budget` is a SINGLETON ROW SHARED BY THE WHOLE PROJECT.** There
 * is no local stack (F02), so every write below lands on the same row the
 * running application reads — this is the developer's own ledger, not a fixture.
 * The row is therefore snapshotted in `beforeAll` and restored after **every
 * test**, and that is not tidiness: without it a run of this suite would leave
 * the shared key tripped for real, and the previous month's totals gone. See
 * `restoreSnapshot` below for why per-test rather than per-suite, and for the
 * residual that remains.
 */

const SUPABASE_URL = requiredEnv('NEXT_PUBLIC_SUPABASE_URL')
const SECRET_KEY = requiredEnv('SUPABASE_SECRET_KEY')

const admin = createClient<Database>(SUPABASE_URL, SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

type Budget = Database['public']['Tables']['shared_key_budget']['Row']

let snapshot: Budget | undefined

/** The first of the current UTC month, which is what period_month stores. */
function thisMonth(): string {
  return `${new Date().toISOString().slice(0, 7)}-01`
}

function lastMonth(): string {
  const now = new Date()
  const previous = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
  return previous.toISOString().slice(0, 10)
}

async function readBudget(): Promise<Budget> {
  const { data, error } = await admin
    .from('shared_key_budget')
    .select('*')
    .eq('id', 1)
    .single()

  if (error) throw new Error(`could not read the budget: ${error.message}`)
  return data
}

/** Puts the ledger in a known state, through the admin client. */
async function setBudget(patch: Partial<Omit<Budget, 'id'>>): Promise<void> {
  const { error } = await admin.from('shared_key_budget').update(patch).eq('id', 1)
  if (error) throw new Error(`could not seed the budget: ${error.message}`)
}

/** What the rate card says a set of totals costs, computed independently here. */
function expectedUsd(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens * SHARED_KEY_INPUT_USD_PER_MILLION +
      outputTokens * SHARED_KEY_OUTPUT_USD_PER_MILLION) /
    1_000_000
  )
}

/** Input tokens that cost slightly more than the whole monthly ceiling. */
const OVER_CEILING_INPUT_TOKENS = Math.ceil(
  ((SHARED_KEY_MONTHLY_USD_CEILING + 1) * 1_000_000) / SHARED_KEY_INPUT_USD_PER_MILLION,
)

/**
 * Column by column rather than spreading the row, so `id` is never in the patch
 * — it carries a check constraint pinning it to 1, and this suite has no
 * business writing it back.
 */
async function restoreSnapshot(): Promise<void> {
  if (!snapshot) return

  await setBudget({
    period_month: snapshot.period_month,
    input_tokens: snapshot.input_tokens,
    output_tokens: snapshot.output_tokens,
    estimated_usd: snapshot.estimated_usd,
    tripped_at: snapshot.tripped_at,
  })
}

/**
 * An abort between the snapshot and the restore leaves the shared key genuinely
 * tripped for real users — which is not a prediction: a network fault did it at
 * F19 and the row sat at `estimated_usd = 11.0000` until it was repaired by
 * hand. There is no local stack to isolate against, so the exposure cannot be
 * removed; it can only be made short and hard to escape.
 *
 * `afterEach` shrinks the window from the length of the suite to the length of
 * one test, and the signal handlers cover the other way out — Ctrl-C, an
 * unhandled rejection, a worker torn down mid-run. `process.once` rather than
 * `on`, so a second signal during the repair still kills the process rather than
 * queueing another write.
 *
 * **The residual is real and stays on the record:** a fault *during* the restore
 * call itself still leaves the row wrong, and no arrangement of hooks fixes
 * that. Only a local stack would, which is F02's open consequence.
 */
const REPAIR_SIGNALS = ['SIGINT', 'SIGTERM', 'uncaughtException'] as const

for (const event of REPAIR_SIGNALS) {
  process.once(event, () => {
    void restoreSnapshot().finally(() => {
      process.exit(1)
    })
  })
}

beforeAll(async () => {
  snapshot = await readBudget()
})

afterEach(restoreSnapshot)

afterAll(restoreSnapshot)

beforeEach(async () => {
  await setBudget({
    period_month: thisMonth(),
    input_tokens: 0,
    output_tokens: 0,
    estimated_usd: 0,
    tripped_at: null,
  })
})

describeHosted('isSharedKeyAvailable', () => {
  it('serves while the month is under its ceiling', async () => {
    expect(await isSharedKeyAvailable()).toBe(true)
  })

  it('refuses once the breaker has tripped this month', async () => {
    await setBudget({ tripped_at: new Date().toISOString() })

    expect(await isSharedKeyAvailable()).toBe(false)
  })

  it('serves again in a new month even though last month is still marked tripped', async () => {
    // The deadlock guard, and the reason the availability check carries a
    // `period_month` term at all. Without it a breaker tripped in one month goes
    // on refusing in the next — and nothing can ever clear it, because the reset
    // lives on the write path in record_shared_budget and this refusal is
    // exactly what stops that write from happening. Reachable by doing nothing.
    await setBudget({
      period_month: lastMonth(),
      tripped_at: new Date().toISOString(),
      estimated_usd: SHARED_KEY_MONTHLY_USD_CEILING,
    })

    expect(await isSharedKeyAvailable()).toBe(true)
  })
})

describeHosted('recordSharedBudgetTokens', () => {
  it('accumulates measured tokens exactly', async () => {
    await recordSharedBudgetTokens({ inputTokens: 300, outputTokens: 8 })
    await recordSharedBudgetTokens({ inputTokens: 120, outputTokens: 40 })

    const budget = await readBudget()
    expect(budget.input_tokens).toBe(420)
    expect(budget.output_tokens).toBe(48)
  })

  it('prices the running totals from the rate card', async () => {
    await recordSharedBudgetTokens({ inputTokens: 2_000_000, outputTokens: 400_000 })

    const budget = await readBudget()
    // 2,000,000 × $1.50/M + 400,000 × $7.50/M = $3.00 + $3.00
    expect(Number(budget.estimated_usd)).toBeCloseTo(expectedUsd(2_000_000, 400_000), 4)
  })

  it('does not lose the fractions of a cent that title generation spends', async () => {
    // The regression this exists for. estimated_usd is numeric(10,4), and one
    // title-sized call is 300 in / 8 out = $0.00051, which STORES as $0.0005 —
    // so a ledger that accumulated dollars per call would drift down by $0.00001
    // every time, always in the same direction.
    //
    // Ten such calls make that visible: derived from the exact token totals the
    // answer is $0.0051, while ten rounded per-call deltas come to $0.0050. The
    // assertion below distinguishes the two, which is the only reason it is
    // worth ten round trips.
    for (let call = 0; call < 10; call += 1) {
      await recordSharedBudgetTokens({ inputTokens: 300, outputTokens: 8 })
    }

    const budget = await readBudget()
    expect(budget.input_tokens).toBe(3_000)
    expect(budget.output_tokens).toBe(80)
    expect(Number(budget.estimated_usd)).toBeCloseTo(0.0051, 6)
    expect(Number(budget.estimated_usd)).not.toBeCloseTo(0.005, 6)
  })

  it('keeps an exact token count even when the call is too small to price', async () => {
    // 10 in / 1 out is $0.0000225, which rounds to $0.0000 in the column. The
    // tokens are still recorded exactly, which is the whole argument for the
    // dollar figure being derived from them rather than the other way round.
    await recordSharedBudgetTokens({ inputTokens: 10, outputTokens: 1 })

    const budget = await readBudget()
    expect(budget.input_tokens).toBe(10)
    expect(budget.output_tokens).toBe(1)
    expect(Number(budget.estimated_usd)).toBe(0)
  })

  it('records one half when the provider reports only the other', async () => {
    await recordSharedBudgetTokens({ outputTokens: 95 })

    const budget = await readBudget()
    expect(budget.input_tokens).toBe(0)
    expect(budget.output_tokens).toBe(95)
  })

  it('writes nothing at all when the provider reported no usage', async () => {
    // An estimate must never enter the table that drives a circuit breaker. A
    // fabricated number does not make the ledger more accurate, it makes the
    // breaker trip for every user on spend that may not have happened.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await recordSharedBudgetTokens({})

    const budget = await readBudget()
    expect(budget.input_tokens).toBe(0)
    expect(budget.output_tokens).toBe(0)
    expect(warn).toHaveBeenCalled()
  })
})

describeHosted('the ceiling', () => {
  it('leaves the breaker alone while spend is under it', async () => {
    await recordSharedBudgetTokens({ inputTokens: 1_000, outputTokens: 100 })

    expect((await readBudget()).tripped_at).toBeNull()
    expect(await isSharedKeyAvailable()).toBe(true)
  })

  it('trips when the month crosses it, and stops serving', async () => {
    await recordSharedBudgetTokens({ inputTokens: OVER_CEILING_INPUT_TOKENS })

    const budget = await readBudget()
    expect(Number(budget.estimated_usd)).toBeGreaterThan(SHARED_KEY_MONTHLY_USD_CEILING)
    expect(budget.tripped_at).not.toBeNull()
    expect(await isSharedKeyAvailable()).toBe(false)
  })

  it('records when spending first crossed the line, not the last time anything was written', async () => {
    await recordSharedBudgetTokens({ inputTokens: OVER_CEILING_INPUT_TOKENS })
    const first = (await readBudget()).tripped_at

    await recordSharedBudgetTokens({ inputTokens: 1_000 })

    expect((await readBudget()).tripped_at).toBe(first)
  })
})

describeHosted('the breaker comes first', () => {
  /**
   * The stand-in for the cookie-bound client. Typed locally and cast once at the
   * seam, because only `.rpc` is reached and building a faithful SupabaseClient
   * here would test the mock rather than the code.
   */
  function stubReservationClient() {
    const rpc = vi.fn().mockResolvedValue({ data: 1, error: null })
    vi.mocked(createServerSupabaseClient).mockResolvedValue({
      rpc,
    } as unknown as Awaited<ReturnType<typeof createServerSupabaseClient>>)
    return rpc
  }

  it('refuses without touching the daily allowance when the budget is spent', async () => {
    // The invariant, stated as an ordering: a tripped breaker must not consume
    // anybody's daily slot on its way to refusing them. Checking after the
    // reservation would spend one of a user's twenty messages to buy them a 503.
    //
    // Asserted on the client factory rather than on the counter, because it
    // proves the stronger thing — the reservation was never even attempted.
    await setBudget({ tripped_at: new Date().toISOString() })
    const rpc = stubReservationClient()

    await expect(reserveSharedSlot(crypto.randomUUID())).rejects.toBeInstanceOf(
      BudgetExhaustedError,
    )

    expect(createServerSupabaseClient).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('goes on to claim a slot while the budget still has room', async () => {
    // The other direction, so the test above cannot pass by the reservation
    // being broken outright.
    const rpc = stubReservationClient()

    await expect(reserveSharedSlot(crypto.randomUUID())).resolves.toBe(1)

    expect(rpc).toHaveBeenCalledWith('reserve_shared_slot', expect.anything())
  })
})

describeHosted('the accounting month rolling over', () => {
  it('starts the totals again and clears the trip on the first write of a new month', async () => {
    await setBudget({
      period_month: lastMonth(),
      input_tokens: 9_000_000,
      output_tokens: 500_000,
      estimated_usd: SHARED_KEY_MONTHLY_USD_CEILING,
      tripped_at: new Date().toISOString(),
    })

    await recordSharedBudgetTokens({ inputTokens: 300, outputTokens: 8 })

    const budget = await readBudget()
    expect(budget.period_month).toBe(thisMonth())
    // This call's usage and nothing else — last month's totals are gone rather
    // than carried, which is what makes the ceiling monthly.
    expect(budget.input_tokens).toBe(300)
    expect(budget.output_tokens).toBe(8)
    expect(budget.tripped_at).toBeNull()
    expect(await isSharedKeyAvailable()).toBe(true)
  })
})
