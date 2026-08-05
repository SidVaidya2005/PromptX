import 'server-only'

import {
  SHARED_KEY_DAILY_MESSAGE_LIMIT,
  SHARED_KEY_INPUT_USD_PER_MILLION,
  SHARED_KEY_MONTHLY_USD_CEILING,
  SHARED_KEY_OUTPUT_USD_PER_MILLION,
} from '@/lib/constants'

import { createServerSupabaseClient, createServiceRoleClient } from '@/server/supabase'

/**
 * The two independent limits on the shared key.
 *
 * **Per user, per day** — a message allowance in `shared_key_usage`. One rule
 * governs it: a slot is CLAIMED, never checked. Reading a count and
 * incrementing it afterwards is a race — two requests at 19 both read "under the
 * limit", both proceed, and the day ends at 21. Every function below is a thin
 * wrapper over a Postgres function that does the check and the write in one
 * statement, and none of them may grow a preceding `select`. These run through
 * the cookie-bound client under the caller's own session; they are
 * `security invoker`, so the owner policy on `shared_key_usage` is what stops
 * one user spending another's allowance.
 *
 * **Globally, per month** — a USD ceiling in `shared_key_budget`, which is a
 * counter with no owner and therefore no `auth.uid()` to scope a policy to. It
 * has RLS enabled and no policy for any role, so it is reachable only through
 * `createServiceRoleClient()` — and this module is the only one permitted to
 * construct one.
 *
 * The axes are independent on purpose and neither substitutes for the other:
 * the daily cap is fairness between users, the monthly ceiling is protection of
 * a real card. **The breaker is evaluated first**, so a tripped breaker refuses
 * without consuming anybody's daily allowance on its way out.
 */

/**
 * Whether the shared key is still serving anyone at all.
 *
 * Three callers, one rule: `reserveSharedSlot()` below turns a false into a
 * refusal, `generateConversationTitle()` skips its call rather than spending,
 * and the chat pages read it to lock the composer before a message is typed.
 * Two spellings of "is the shared key still serving" would drift, and the
 * disagreement would be invisible in both directions.
 *
 * **Fails open.** A transient failure reading one row must not take the product
 * down for everyone, and the authoritative spend cap is not this function — it
 * is the hard budget limit on the Google billing account behind
 * `SHARED_GEMINI_API_KEY` (feature 38). This breaker exists to stop runaway
 * usage early and say so clearly; failing closed would trade a real outage for a
 * few hypothetical cents.
 */
export async function isSharedKeyAvailable(): Promise<boolean> {
  const supabase = createServiceRoleClient()

  const { data, error } = await supabase.rpc('is_shared_key_available')

  if (error) {
    console.error('[server/quota] breaker check failed; allowing', { code: error.code })
    return true
  }

  // Null means the singleton row is missing, which is a broken deployment
  // rather than a spent budget. Same posture as an error: allow, and let the
  // provider-side cap be the thing that actually stops spending.
  return data ?? true
}

/**
 * Claims one shared-key message slot for today.
 *
 * Called before the provider request, so a refusal leaves nothing behind — no
 * conversation, no prompt with no answer. The caller must release the slot if
 * the generation then fails.
 *
 * @throws BudgetExhaustedError when the global monthly ceiling is spent (503).
 * @throws QuotaExceededError when this user's daily allowance is spent (429).
 */
export async function reserveSharedSlot(userId: string): Promise<number> {
  // FIRST, and the ordering is the invariant rather than a preference. Claiming
  // the slot before this check would spend a message out of someone's daily
  // allowance to buy them a 503 — charging a user for a refusal the application
  // had already decided on.
  if (!(await isSharedKeyAvailable())) {
    throw new BudgetExhaustedError()
  }

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
 * Records what one user's message actually cost, on both ledgers.
 *
 * Accounting, never enforcement. Nothing is ever refused on the strength of
 * these numbers — the daily limit counts messages, and the breaker is checked
 * before a request rather than during it — so a usage report that arrives late,
 * or not at all, cannot lock anybody out of anything.
 */
export async function recordSharedKeyTokens(
  userId: string,
  usage: MeasurableUsage,
): Promise<void> {
  const measured = measuredOnly(usage, userId)
  if (!measured) return

  const supabase = await createServerSupabaseClient()

  const { error } = await supabase.rpc('record_shared_tokens', {
    p_user_id: userId,
    p_input_tokens: measured.inputTokens,
    p_output_tokens: measured.outputTokens,
  })

  if (error) {
    console.error('[server/quota] recordSharedKeyTokens failed', { userId, code: error.code })
  }

  await recordSharedBudgetTokens(usage)
}

/**
 * Records spend against the global ledger only, with no user attached.
 *
 * This is the entry point for **system overhead** — work the shared key does
 * that no user asked for, which today means conversation titling. It costs real
 * money and belongs in `shared_key_budget`; it is not a message and belongs
 * nowhere near anybody's daily allowance.
 *
 * Taking no user id is the mechanism, not an oversight. `sharedTitleModel()`
 * takes none for the same reason: a function with nobody to charge cannot
 * quietly start charging them. Note that the reconciliation sweep cannot cover
 * for a missed call here — it derives usage from `messages` rows carrying
 * `used_shared_key`, and a title writes no message row, so these tokens are
 * invisible to it by construction.
 */
export async function recordSharedBudgetTokens(usage: MeasurableUsage): Promise<void> {
  const measured = measuredOnly(usage)
  if (!measured) return

  const supabase = createServiceRoleClient()

  const { error } = await supabase.rpc('record_shared_budget', {
    p_input_tokens: measured.inputTokens,
    p_output_tokens: measured.outputTokens,
    p_input_usd_per_million: SHARED_KEY_INPUT_USD_PER_MILLION,
    p_output_usd_per_million: SHARED_KEY_OUTPUT_USD_PER_MILLION,
    p_ceiling_usd: SHARED_KEY_MONTHLY_USD_CEILING,
  })

  if (error) {
    console.error('[server/quota] recordSharedBudgetTokens failed', { code: error.code })
  }
}

/** What the AI SDK reports after a call. Both counts may genuinely be absent. */
type MeasurableUsage = { inputTokens?: number; outputTokens?: number }

/**
 * The measured-usage-only rule, in one place because two ledgers obey it.
 *
 * Returns null when the provider reported nothing, so the caller writes nothing.
 * The alternative — substituting zero — would put an invented number into the
 * table that drives a circuit breaker, and a breaker fed on estimates trips for
 * every user on spend that may never have happened. A small systematic
 * undercount is the accepted failure mode instead, which is why the ceiling
 * carries headroom and why the real guarantee is the provider-side cap.
 *
 * One count present and the other missing is still measured: the absent half
 * becomes zero rather than discarding the half that was reported.
 */
function measuredOnly(
  usage: MeasurableUsage,
  userId?: string,
): { inputTokens: number; outputTokens: number } | null {
  if (usage.inputTokens === undefined && usage.outputTokens === undefined) {
    console.warn('[server/quota] provider reported no usage; nothing recorded', { userId })
    return null
  }

  return {
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
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

/**
 * The shared key's monthly budget is spent, for everyone. Maps to 503.
 *
 * 503 rather than 429, and the difference is not cosmetic: 429 says "you have
 * had your share, come back tomorrow", which would be a lie here. Nothing this
 * user does — waiting, sending less — changes the answer, and the only route
 * onward is a key of their own. The message says that instead of naming a
 * ceiling that is the operator's problem rather than theirs.
 *
 * Users with their own key never reach this. They return from `resolveModel()`
 * before the shared branch, so they are unaffected by construction rather than
 * by an exemption somebody has to remember to write.
 */
export class BudgetExhaustedError extends Error {
  constructor() {
    super('Shared access is temporarily unavailable')
    this.name = 'BudgetExhaustedError'
  }
}
