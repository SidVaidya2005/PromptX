import 'server-only'

import { SHARED_KEY_DAILY_MESSAGE_LIMIT } from '@/lib/constants'

import { createServerSupabaseClient } from '@/server/supabase'

/**
 * The shared key's daily allowance, per user.
 *
 * One rule governs this file: a slot is CLAIMED, never checked. Reading a count
 * and incrementing it afterwards is a race — two requests at 19 both read "under
 * the limit", both proceed, and the day ends at 21. Every function here is a
 * thin wrapper over a Postgres function that does the check and the write in one
 * statement, and none of them may grow a preceding `select`.
 *
 * All three run through the cookie-bound client, under the caller's own session.
 * They are `security invoker`, so the owner policy on `shared_key_usage` is what
 * stops one user spending another's allowance — this module does not need, and
 * must not acquire, an RLS-bypassing client to do its job.
 *
 * FEATURE 17 adds the second, independent axis: a global monthly ceiling in
 * `shared_key_budget`, checked BEFORE the reservation below so a tripped breaker
 * cannot consume a user's daily slot. That table has no RLS policy for any role,
 * so it is also where `createServiceRoleClient()` finally becomes necessary.
 * Until then the service-role client does not exist anywhere in this codebase,
 * which is the strongest guarantee available that nothing is quietly using one.
 */

/**
 * Claims one shared-key message slot for today.
 *
 * Called before the provider request, so a refusal leaves nothing behind — no
 * conversation, no prompt with no answer. The caller must release the slot if
 * the generation then fails.
 *
 * @throws QuotaExceededError when the daily allowance is already spent (429).
 */
export async function reserveSharedSlot(userId: string): Promise<number> {
  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase.rpc('reserve_shared_slot', {
    p_user_id: userId,
    p_limit: SHARED_KEY_DAILY_MESSAGE_LIMIT,
  })

  if (error) {
    console.error('[server/quota] reserveSharedSlot failed', { userId, code: error.code })
    throw new Error('Failed to check the shared-key allowance')
  }

  // No row is the EXPECTED refusal, not a fault: the conditional upsert matched
  // nothing because the count had already reached the limit. PostgREST renders a
  // zero-row `returns integer` as null, which is why this is a null check rather
  // than a comparison against the limit — comparing here would be a second copy
  // of the rule the database just applied.
  if (data === null) {
    throw new QuotaExceededError()
  }

  return data
}

/**
 * Refunds a slot claimed for a generation that never arrived.
 *
 * Deliberately does not throw. Every caller is already handling a failure — an
 * aborted stream, a provider error, a write that did not land — and turning a
 * refund failure into a second error would replace a message the user can act on
 * with one they cannot. The reconciliation sweep corrects a missed release
 * within ten minutes, so the cost of swallowing this is bounded and self-healing;
 * the cost of throwing is a broken error path.
 */
export async function releaseSharedSlot(userId: string): Promise<void> {
  const supabase = await createServerSupabaseClient()

  const { error } = await supabase.rpc('release_shared_slot', { p_user_id: userId })

  if (error) {
    console.error('[server/quota] releaseSharedSlot failed', { userId, code: error.code })
  }
}

/**
 * Records measured token usage against today's row.
 *
 * Accounting, never enforcement. Nothing is ever refused on the strength of
 * these numbers — the daily limit counts messages — so a usage report that
 * arrives late, or not at all, cannot lock anybody out.
 *
 * Only MEASURED usage is written. The AI SDK types both counts as possibly
 * undefined, and a provider that fails mid-stream may report neither; this skips
 * the write rather than substituting zero, because at feature 17 these totals
 * feed a circuit breaker and an invented number there trips it for every user on
 * spend that never happened.
 *
 * FEATURE 17: this is where the same measured usage is added to
 * `shared_key_budget` and `estimated_usd` is recomputed against the Flash rate
 * card. The Postgres function needs no change — it already writes everything
 * this axis owns.
 */
export async function recordSharedKeyTokens(
  userId: string,
  usage: { inputTokens?: number; outputTokens?: number },
): Promise<void> {
  if (usage.inputTokens === undefined && usage.outputTokens === undefined) {
    console.warn('[server/quota] provider reported no usage; nothing recorded', { userId })
    return
  }

  const supabase = await createServerSupabaseClient()

  const { error } = await supabase.rpc('record_shared_tokens', {
    p_user_id: userId,
    p_input_tokens: usage.inputTokens ?? 0,
    p_output_tokens: usage.outputTokens ?? 0,
  })

  if (error) {
    console.error('[server/quota] recordSharedKeyTokens failed', { userId, code: error.code })
  }
}

/**
 * The caller has spent today's shared-key allowance. Maps to 429.
 *
 * Carries no user id and no count — it is thrown into a response path, and the
 * number the interface shows comes from the meter's own read rather than from
 * an error message.
 */
export class QuotaExceededError extends Error {
  constructor() {
    super(`You've used your ${SHARED_KEY_DAILY_MESSAGE_LIMIT} free messages for today`)
    this.name = 'QuotaExceededError'
  }
}
