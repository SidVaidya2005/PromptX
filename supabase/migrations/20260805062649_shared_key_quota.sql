-- The per-user half of the shared-key cap.
--
-- Three functions, and the first one is the whole feature. Checking a count and
-- incrementing it afterwards is a race: two requests at 19 both read "under the
-- limit", both proceed, and the day ends at 21. The check and the increment
-- must therefore be the SAME STATEMENT.
--
-- All three are `security invoker`. They run under the caller's session, which
-- is why 20260731071513_rls_policies.sql grants shared_key_usage insert and
-- update to `authenticated` — the owner policy is what stops one user spending
-- another's allowance, and these functions inherit it rather than bypass it.
-- That also makes their grant posture the INVERSE of the cron functions in
-- 20260731065321_scheduled_jobs.sql, which revoke execute from authenticated
-- precisely because nobody should be able to call them by hand.
--
-- Every one of them touches `updated_at`. That is not bookkeeping: the
-- reconciliation sweep treats a row untouched for five minutes as holding an
-- orphaned reservation, so a function that forgets the column leaves it frozen
-- at its insert value, makes every row look stale, and starts releasing
-- reservations that are still in flight.
--
-- The global axis — shared_key_budget, estimated_usd, the circuit breaker —
-- is feature 17 and is deliberately absent here.

-- ─── Claim a slot ────────────────────────────────────────────────────────────

-- Returns the new count on success, or NO ROW when the allowance is spent.
--
-- The `where` on the `do update` branch is the race guard, and it must never be
-- replaced with a preceding `select`. Postgres serialises concurrent updates on
-- the same row, so under load the second one evaluates its condition against
-- the first one's committed value, matches nothing, and returns nothing. A read
-- followed by a write — even inside one transaction at read committed — reopens
-- exactly the window this exists to close.
--
-- Returning no row is the EXPECTED refusal path, not an error condition.
create function public.reserve_shared_slot(p_user_id uuid, p_limit integer)
returns integer
language sql
security invoker
set search_path = public
as $$
  insert into public.shared_key_usage (user_id, usage_date, message_count, updated_at)
  values (p_user_id, (now() at time zone 'utc')::date, 1, now())
  on conflict (user_id, usage_date) do update
    set message_count = public.shared_key_usage.message_count + 1,
        updated_at    = now()
    where public.shared_key_usage.message_count < p_limit
  returning message_count;
$$;

comment on function public.reserve_shared_slot(uuid, integer) is
  'Atomically claims one shared-key message slot for today. Returns the new count, or no row when the daily allowance is already spent. The where clause on the do-update branch is the race guard.';

-- ─── Refund a slot ───────────────────────────────────────────────────────────

-- Called when a generation fails, is aborted, or is never persisted. A user is
-- never charged for a response they did not receive.
--
-- Floored at zero so a double release — an onError and an onAbort both firing,
-- say — cannot drive the counter negative and hand out a free message.
create function public.release_shared_slot(p_user_id uuid)
returns void
language sql
security invoker
set search_path = public
as $$
  update public.shared_key_usage
     set message_count = greatest(message_count - 1, 0),
         updated_at    = now()
   where user_id = p_user_id
     and usage_date = (now() at time zone 'utc')::date;
$$;

comment on function public.release_shared_slot(uuid) is
  'Refunds one reserved slot, floored at zero. Accounting for a generation that never arrived.';

-- ─── Record measured tokens ──────────────────────────────────────────────────

-- Accounting only, never enforcement. The daily limit is counted in messages,
-- and no limit is ever tested against these columns — a token total that
-- arrives late or not at all must not be able to refuse anybody.
--
-- This writes shared_key_usage and nothing else. Feature 17 adds the
-- shared_key_budget accumulation and the circuit breaker in the TypeScript
-- wrapper, not here, so this function is already complete.
create function public.record_shared_tokens(
  p_user_id uuid,
  p_input_tokens bigint,
  p_output_tokens bigint
)
returns void
language sql
security invoker
set search_path = public
as $$
  update public.shared_key_usage
     set input_tokens  = input_tokens + p_input_tokens,
         output_tokens = output_tokens + p_output_tokens,
         updated_at    = now()
   where user_id = p_user_id
     and usage_date = (now() at time zone 'utc')::date;
$$;

comment on function public.record_shared_tokens(uuid, bigint, bigint) is
  'Adds measured token usage to today''s row. Accounting, never enforcement.';

-- ─── Grants ──────────────────────────────────────────────────────────────────

-- The inverse of the cron functions: these are called BY a signed-in user, on
-- their own row, through the cookie-bound client. anon gets nothing — there is
-- no auth.uid() for the owner policy to match, so a call would write nothing
-- anyway, but saying so explicitly is cheaper than reasoning about it later.
revoke execute on function public.reserve_shared_slot(uuid, integer) from public, anon;
revoke execute on function public.release_shared_slot(uuid) from public, anon;
revoke execute on function public.record_shared_tokens(uuid, bigint, bigint) from public, anon;

grant execute on function public.reserve_shared_slot(uuid, integer) to authenticated;
grant execute on function public.release_shared_slot(uuid) to authenticated;
grant execute on function public.record_shared_tokens(uuid, bigint, bigint) to authenticated;
