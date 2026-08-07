-- The global half of the shared-key cap, and the second of the two independent
-- axes architecture.md requires. 20260805062649_shared_key_quota.sql caps what
-- one user may send in a day; nothing until now caps what everyone costs in a
-- month, and the key is billed to a real card.
--
-- Both functions are `security invoker` and reachable only by `service_role`.
-- That combination is what keeps handle_new_user() the single sanctioned
-- `security definer` function in this codebase: shared_key_budget has RLS
-- enabled and NO policy for any role, so an invoker-rights function sees
-- nothing when called by `authenticated` — and `service_role` bypasses RLS
-- without the function needing elevation of its own. The execute grants below
-- make that structural rather than conventional: a signed-in user cannot call
-- either of these at all.
--
-- The accounting month is the UTC calendar month, matching how
-- shared_key_usage.usage_date and the sidebar's day groups already work.

-- ─── Is the shared key still serving? ────────────────────────────────────────

-- Checked BEFORE a daily slot is claimed, never after: a tripped breaker must
-- not consume somebody's allowance on its way to refusing them.
--
-- The `period_month` term is not redundant, and leaving it out is a deadlock
-- rather than a slow reset. A breaker tripped in October would go on refusing
-- in November, and nothing could ever clear it — the reset lives on the write
-- path in record_shared_budget below, and the refusal is precisely what stops
-- that write from happening. The month guard lives here, next to the function
-- that maintains the column, so the two cannot drift apart.
create function public.is_shared_key_available()
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select not (
    b.tripped_at is not null
    and b.period_month = date_trunc('month', now() at time zone 'utc')::date
  )
  from public.shared_key_budget b
  where b.id = 1;
$$;

comment on function public.is_shared_key_available() is
  'False only while the breaker is tripped FOR THE CURRENT accounting month. The month term prevents a stale trip from wedging the shared key shut permanently, since the reset it waits for lives on a write path the refusal itself blocks.';

-- ─── Accumulate spend, and trip when the ceiling is crossed ──────────────────

-- Two statements, one transaction, and the split is deliberate.
--
-- Statement one increments SELF-REFERENTIALLY (`input_tokens = input_tokens +
-- $1`), which is what makes it atomic: Postgres re-reads the row under its own
-- lock and evaluates the arithmetic against that, so two concurrent
-- completions cannot both add to the same stale total. Reading the totals into
-- variables first and writing them back would reopen exactly the lost-update
-- window 20260805062649_shared_key_quota.sql was written to close.
--
-- estimated_usd cannot be computed in that same statement, because SET cannot
-- reference another column's NEW value. So statement one RETURNS the new
-- totals and statement two derives the money from them. That is safe for one
-- specific reason: statement one has already taken a row lock which is held to
-- the end of this function's transaction, so nothing can interleave between
-- them.
--
-- Why derive rather than accumulate, measured rather than assumed. A generated
-- title is roughly 300 in / 8 out, which is $0.00051 — and estimated_usd is
-- numeric(10,4), so storing that per call keeps $0.0005. Not nothing, which is
-- what a first guess here would say, but 2,000 titles accumulated one at a time
-- come to $1.0000 against a true $1.0200: a systematic 2% undercount, always
-- downward, in the number a circuit breaker is read off.
--
-- The stronger reason is that accumulating dollars separately would make
-- estimated_usd and the token columns two independent records of one fact, free
-- to drift apart with nothing to notice. Derived, the money is a pure function
-- of exact bigint totals and cannot disagree with them.
create function public.record_shared_budget(
  p_input_tokens           bigint,
  p_output_tokens          bigint,
  p_input_usd_per_million  numeric,
  p_output_usd_per_million numeric,
  p_ceiling_usd            numeric
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_month        date := date_trunc('month', now() at time zone 'utc')::date;
  v_input_total  bigint;
  v_output_total bigint;
  v_usd          numeric;
begin
  -- The `case` arms are the month rollover: a stale period_month means these
  -- totals belong to a month that is over, so they start again from this call's
  -- usage and the previous month's trip is cleared. No scheduled job is needed
  -- — the reset happens exactly when the next spend arrives.
  update public.shared_key_budget
     set input_tokens  = case when period_month = v_month then input_tokens  else 0 end
                         + p_input_tokens,
         output_tokens = case when period_month = v_month then output_tokens else 0 end
                         + p_output_tokens,
         tripped_at    = case when period_month = v_month then tripped_at    else null end,
         period_month  = v_month
   where id = 1
  returning input_tokens, output_tokens into v_input_total, v_output_total;

  if not found then
    raise warning 'shared_key_budget singleton row is missing; nothing recorded';
    return;
  end if;

  v_usd := (v_input_total  * p_input_usd_per_million
          + v_output_total * p_output_usd_per_million) / 1000000;

  -- v_usd is compared at full precision and only then stored into a column that
  -- rounds to four places. Comparing the rounded figure instead would move the
  -- ceiling by up to a hundredth of a cent for no reason.
  --
  -- coalesce, not now(): a breaker already tripped keeps its original timestamp,
  -- so the ledger records when spending first crossed the line rather than the
  -- most recent time anything was written.
  update public.shared_key_budget
     set estimated_usd = v_usd,
         tripped_at    = case
                           when v_usd >= p_ceiling_usd then coalesce(tripped_at, now())
                           else tripped_at
                         end
   where id = 1;
end;
$$;

comment on function public.record_shared_budget(bigint, bigint, numeric, numeric, numeric) is
  'Adds MEASURED token usage to the global ledger, recomputes estimated_usd from the cumulative totals, and trips the breaker when the ceiling is crossed. Rolls the accounting month over when period_month is stale. Never called with estimated usage.';

-- ─── Grants ──────────────────────────────────────────────────────────────────

-- Neither function is callable by a signed-in user, and that is the point.
-- shared_key_budget is a global counter with no owner, so there is no
-- auth.uid() to scope it to and no RLS policy protecting it — the execute grant
-- IS the access control here. src/server/quota.ts reaches both through
-- createServiceRoleClient(), the only RLS-bypassing client in the codebase.
revoke execute on function public.is_shared_key_available() from public, anon, authenticated;
revoke execute on function public.record_shared_budget(bigint, bigint, numeric, numeric, numeric)
  from public, anon, authenticated;

grant execute on function public.is_shared_key_available() to service_role;
grant execute on function public.record_shared_budget(bigint, bigint, numeric, numeric, numeric)
  to service_role;
