-- Scheduled jobs. Two of them, deliberately split across two mechanisms.
--
-- Render Cron Jobs are a paid service type unavailable on the free tier, so
-- both jobs run inside Postgres. But a storage object CANNOT be deleted with
-- SQL — deleting a storage.objects row leaves the file stranded in the bucket
-- permanently. So the reaper has to reach the Storage API through an Edge
-- Function, while quota reconciliation is pure database work with nothing to
-- call out to.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ─── Quota reconciliation (every 10 minutes, pure SQL) ───────────────────────

-- A shared-key slot is reserved before the provider call and released in
-- onError. If the process dies in between — a deploy mid-request, an OOM kill —
-- neither path runs and the slot stays claimed for a generation the user never
-- received. This sweep is the self-healing half of that bargain.
--
-- security invoker, not definer: it is called by pg_cron as the table owner,
-- which bypasses RLS without needing an elevated function. library-docs.md
-- forbids security definer without a written reason, and there isn't one here.
create function public.reconcile_shared_key_usage()
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

  -- ONLY EVER LOWERS the counter. It can release a stuck slot but can never
  -- charge a user for something the reservation missed. messages is the source
  -- of truth: a complete assistant message with used_shared_key is proof that a
  -- generation was actually delivered.
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
                 and (m.created_at at time zone 'utc')::date = u2.usage_date) as actual
        from public.shared_key_usage u2
       -- THE STALENESS GUARD. Without it the sweep races live requests and
       -- hands out slots that are genuinely in use. STREAM_TIMEOUT_MS is 2
       -- minutes, so 5 is comfortably past any request we allow to live; a
       -- younger row may be a live reservation.
       where u2.updated_at < now() - interval '5 minutes'
    ) sub
   where u.user_id       = sub.user_id
     and u.usage_date    = sub.usage_date
     and u.message_count > sub.actual;
end;
$$;

revoke execute on function public.reconcile_shared_key_usage() from public, anon, authenticated;

select cron.schedule(
  'reconcile-shared-quota',
  '*/10 * * * *',
  $$ select public.reconcile_shared_key_usage() $$
);

-- ─── Attachment reaping (hourly, via pg_net → Edge Function) ─────────────────

-- The Edge Function this posts to is built in feature 28. Until then the job is
-- registered and runs green: it looks for its Vault secrets, finds them absent,
-- and returns. Scheduling a bare net.http_post now would instead fire ~730
-- failed requests a month at a URL that does not resolve, and bury real
-- failures in a cron.job_run_details full of red.
--
-- The service key lives in Vault, not in a database setting. current_setting()
-- would store a service_role key in plaintext configuration readable by
-- anything that can call show — on a codebase whose whole posture is that
-- secrets do not sit in readable places.
create function public.reap_attachments_tick()
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_edge_url    text;
  v_service_key text;
begin
  select decrypted_secret into v_edge_url
    from vault.decrypted_secrets
   where name = 'reap_attachments_edge_url';

  select decrypted_secret into v_service_key
    from vault.decrypted_secrets
   where name = 'reap_attachments_service_key';

  if v_edge_url is null or v_service_key is null then
    raise notice '[reap-attachments] vault secrets absent — skipping until feature 28';
    return;
  end if;

  perform net.http_post(
    url     := v_edge_url,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_service_key
    )
  );
end;
$$;

revoke execute on function public.reap_attachments_tick() from public, anon, authenticated;

select cron.schedule(
  'reap-orphaned-attachments',
  '0 * * * *',
  $$ select public.reap_attachments_tick() $$
);
