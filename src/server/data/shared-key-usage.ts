import 'server-only'

import { createServerSupabaseClient } from '@/server/supabase'

/**
 * Reading the caller's shared-key usage for today.
 *
 * The writes do not live here. Reserving and releasing a slot go through
 * Postgres functions called from `src/server/quota.ts`, because the claim and
 * the increment have to be one statement — which is a policy decision, not a
 * query. What is left for this module is the plain read the interface needs, and
 * it lives here because `.from()` is confined to `src/server/data/` by an ESLint
 * rule that `.rpc()` does not trip.
 */

/**
 * How many shared-key messages the caller has claimed today, in UTC.
 *
 * Zero when no row exists — the row is created by the first reservation of the
 * day, so its absence means an untouched allowance rather than missing data.
 *
 * The date is computed here rather than in Postgres so that this read and
 * `reserve_shared_slot` agree on which day it is. Both take the UTC calendar
 * day, matching `shared_key_usage.usage_date` and the sidebar's own grouping.
 *
 * No `.eq('user_id', …)`. The owner policy is `(select auth.uid()) = user_id`,
 * so the cookie-bound client sees only the caller's row; a filter would suggest
 * the filter is what isolates it.
 */
export async function getTodaysUsage(): Promise<number> {
  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase
    .from('shared_key_usage')
    .select('message_count')
    .eq('usage_date', utcToday())
    .maybeSingle()

  if (error) {
    console.error('[data/shared-key-usage] getTodaysUsage failed', error)
    throw new Error('Failed to load shared-key usage')
  }

  return data?.message_count ?? 0
}

/** The UTC calendar day as `YYYY-MM-DD`, which is what `usage_date` stores. */
function utcToday(): string {
  return new Date().toISOString().slice(0, 10)
}
