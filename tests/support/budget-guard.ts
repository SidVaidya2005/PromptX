import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'

type Budget = Database['public']['Tables']['shared_key_budget']['Row']

/**
 * Snapshot-and-restore for `shared_key_budget`, which is a **singleton row
 * shared by the whole project** rather than a fixture.
 *
 * There is no local stack (F02), so any suite that writes this row is writing
 * the ledger the running application reads — the developer's own month, and the
 * input to the circuit breaker that decides whether the shared key answers
 * anybody at all. A run that ends between a mutation and its restore leaves the
 * shared key genuinely tripped for real users. That is not a prediction: a
 * network fault did it at F19 and the row sat at `estimated_usd = 11.0000` until
 * it was repaired by hand.
 *
 * Lives here rather than inside one suite because two now need it, and the
 * second is easy to miss: `recordSharedKeyTokens()` writes a user's own row
 * **and** forwards to `recordSharedBudgetTokens()`, so a test of the per-user
 * wrapper silently spends against the global ledger too.
 *
 * `afterEach` shrinks the exposure from the length of a suite to the length of
 * one test; the signal handlers cover Ctrl-C and an uncaught throw. **The
 * residual stays on the record:** a fault *during* the restore call itself still
 * leaves the row wrong, and no arrangement of hooks fixes that — only a local
 * stack would.
 */
export function budgetGuard(admin: SupabaseClient<Database>) {
  let snapshot: Budget | undefined

  async function read(): Promise<Budget> {
    const { data, error } = await admin
      .from('shared_key_budget')
      .select('*')
      .eq('id', 1)
      .single()

    if (error) throw new Error(`could not read the budget: ${error.message}`)
    return data
  }

  async function restore(): Promise<void> {
    if (!snapshot) return

    // Column by column rather than spreading the row, so `id` is never in the
    // patch — it carries a check constraint pinning it to 1, and no test has any
    // business writing it back.
    const { error } = await admin
      .from('shared_key_budget')
      .update({
        period_month: snapshot.period_month,
        input_tokens: snapshot.input_tokens,
        output_tokens: snapshot.output_tokens,
        estimated_usd: snapshot.estimated_usd,
        tripped_at: snapshot.tripped_at,
      })
      .eq('id', 1)

    if (error) throw new Error(`could not restore the budget: ${error.message}`)
  }

  // `once` rather than `on`, so a second signal during the repair kills the
  // process instead of queueing another write.
  for (const event of ['SIGINT', 'SIGTERM', 'uncaughtException'] as const) {
    process.once(event, () => {
      void restore().finally(() => {
        process.exit(1)
      })
    })
  }

  return {
    /** Call from `beforeAll`. */
    async take(): Promise<void> {
      snapshot = await read()
    },
    /** Call from `afterEach` and `afterAll`. */
    restore,
    read,
    current: () => snapshot,
  }
}
