-- Shared-key slots that will never be backed by a message row. (F31)
--
-- The reconciliation sweep in 20260731065321_scheduled_jobs.sql derives truth
-- from `messages`: for any row untouched for five minutes it sets message_count
-- to the number of complete shared-key assistant messages that day, and only
-- ever lowers it. That is exactly right for chat, where every spent slot leaves
-- a row behind.
--
-- The compare view spends the shared key and persists NOTHING — that is its
-- stated invariant, not an oversight. So every slot a comparison claims would
-- be handed back within ten minutes, and the daily cap would silently stop
-- applying to /compare altogether: two generations per comparison, unbounded,
-- with only the global monthly breaker left to stop them.
--
-- This adds the second counter the sweep needs to tell "never persisted" apart
-- from "reserved and then lost". It is deliberately NOT a second allowance:
-- message_count remains the only counter enforcement is tested against, so chat
-- and compare share one twenty-a-day, and getTodaysUsage() reads the same
-- column it always did.
--
-- The tradeoff, stated rather than hidden: a compare slot orphaned by a process
-- that died mid-stream is no longer self-healed by the sweep. It is bounded —
-- the row is keyed by usage_date, so it clears at 00:00 UTC — and it errs
-- toward charging rather than refunding, which is the safe direction for a
-- counter protecting somebody's card.

alter table public.shared_key_usage
  add column compare_count integer not null default 0;

comment on column public.shared_key_usage.compare_count is
  'How many of today''s claimed slots produced no messages row. The reconciliation sweep adds this to the message count it reconciles against; without it every compare slot is refunded within ten minutes. Not a second allowance — message_count is still the only counter the limit is tested against.';

-- ─── Claim a slot ────────────────────────────────────────────────────────────

-- DROPPED rather than replaced, because the argument list changes. `create or
-- replace` with a new arity creates a SECOND function and leaves the old one
-- serving PostgREST, so an rpc() call naming only the old parameters would keep
-- getting the old behaviour with nothing to say so.
drop function public.reserve_shared_slot(uuid, integer);

-- Still ONE statement, and the new counter moves inside it. Splitting the
-- compare increment into a second update would reopen the window the whole
-- function exists to close — and worse than the original race, because the two
-- counters could then disagree and the sweep reads both.
--
-- p_persisted defaults to true so that the ordinary send path says nothing about
-- a distinction it does not have. Only the caller that will write no row has to
-- know it exists.
create function public.reserve_shared_slot(
  p_user_id uuid,
  p_limit integer,
  p_persisted boolean default true
)
returns integer
language sql
security invoker
set search_path = public
as $$
  insert into public.shared_key_usage (
    user_id, usage_date, message_count, compare_count, updated_at
  )
  values (
    p_user_id,
    (now() at time zone 'utc')::date,
    1,
    case when p_persisted then 0 else 1 end,
    now()
  )
  on conflict (user_id, usage_date) do update
    set message_count = public.shared_key_usage.message_count + 1,
        compare_count = public.shared_key_usage.compare_count
                        + case when p_persisted then 0 else 1 end,
        updated_at    = now()
    where public.shared_key_usage.message_count < p_limit
  returning message_count;
$$;

comment on function public.reserve_shared_slot(uuid, integer, boolean) is
  'Atomically claims one shared-key message slot for today. Returns the new count, or no row when the daily allowance is already spent. The where clause on the do-update branch is the race guard. p_persisted false also increments compare_count, for a generation that will never leave a messages row for the reconciliation sweep to find.';

-- ─── Refund a slot ───────────────────────────────────────────────────────────

drop function public.release_shared_slot(uuid);

-- Both counters fall together, and both are floored at zero for the reason the
-- original recorded: an onError and an onAbort can both fire for one request,
-- and a double release must not hand out a free message.
create function public.release_shared_slot(
  p_user_id uuid,
  p_persisted boolean default true
)
returns void
language sql
security invoker
set search_path = public
as $$
  update public.shared_key_usage
     set message_count = greatest(message_count - 1, 0),
         compare_count = case
                           when p_persisted then compare_count
                           else greatest(compare_count - 1, 0)
                         end,
         updated_at    = now()
   where user_id = p_user_id
     and usage_date = (now() at time zone 'utc')::date;
$$;

comment on function public.release_shared_slot(uuid, boolean) is
  'Refunds one reserved slot, floored at zero. Accounting for a generation that never arrived. p_persisted must match the reserve call, or compare_count is left holding a slot message_count no longer has.';

-- ─── The sweep, taught to count them ─────────────────────────────────────────

-- Same shape as 20260731065321_scheduled_jobs.sql, with one term added to
-- `actual`. Everything else about it is unchanged and still load-bearing: it
-- only ever LOWERS the counter, and the five-minute staleness guard is what
-- keeps it from racing live requests.
create or replace function public.reconcile_shared_key_usage()
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  -- A process that dies mid-stream leaves an assistant row stuck in 'streaming'
  -- that renders as a message loading forever. Retire it on the same bound.
  update public.messages
     set status        = 'error',
         error_message = 'Generation was interrupted'
   where status = 'streaming'
     and created_at < now() - interval '5 minutes';

  update public.shared_key_usage u
     set message_count = sub.actual,
         updated_at    = now()
    from (
      select u2.user_id,
             u2.usage_date,
             (select count(*)
                from public.messages m
               where m.user_id = u2.user_id
                 and m.used_shared_key
                 and m.role = 'assistant'
                 and m.status = 'complete'
                 and (m.created_at at time zone 'utc')::date = u2.usage_date)
             -- THE F31 TERM. The compare view persists nothing, so its slots are
             -- invisible to the count above; without this the sweep refunds
             -- every one of them and /compare stops obeying the daily cap.
             + u2.compare_count as actual
        from public.shared_key_usage u2
       where u2.updated_at < now() - interval '5 minutes'
    ) sub
   where u.user_id       = sub.user_id
     and u.usage_date    = sub.usage_date
     and u.message_count > sub.actual;
end;
$$;

-- ─── Grants ──────────────────────────────────────────────────────────────────

-- Re-issued because both functions were dropped: a grant belongs to a signature,
-- and the signatures changed. The posture is the original one — called BY a
-- signed-in user, on their own row, through the cookie-bound client, with the
-- owner policy doing the isolating.
revoke execute on function public.reserve_shared_slot(uuid, integer, boolean) from public, anon;
revoke execute on function public.release_shared_slot(uuid, boolean) from public, anon;

grant execute on function public.reserve_shared_slot(uuid, integer, boolean) to authenticated;
grant execute on function public.release_shared_slot(uuid, boolean) to authenticated;

revoke execute on function public.reconcile_shared_key_usage() from public, anon, authenticated;
