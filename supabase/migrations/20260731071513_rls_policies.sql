-- Row-Level Security policies. Feature 02 enabled RLS on all eight tables and
-- defined no policy, which is deny-all; this is where access is granted back,
-- deliberately, one command at a time.
--
-- Two conventions run through every policy below, and both are load-bearing.
--
-- 1. `(select auth.uid())`, never a bare `auth.uid()`. Postgres treats the bare
--    call as volatile and re-evaluates it once per row; wrapped in a subquery it
--    is evaluated once and cached as an InitPlan. Supabase's linter reports the
--    bare form as auth_rls_initplan. architecture.md's example block shows the
--    bare form and is amended alongside this migration.
--
-- 2. Every owner policy is `to authenticated`. Without the role clause a policy
--    applies to every role including anon, where auth.uid() is null and the
--    comparison yields null — safe, but it also makes the owner policies overlap
--    the anon share policies on conversations and messages, which Postgres then
--    has to OR together per row and the linter reports as
--    multiple_permissive_policies.
--
-- On `update`: Postgres reuses the `using` expression as the `with check`
-- expression when the latter is omitted, so writing both is documentation
-- rather than a correction. It is worth writing anyway — it states outright
-- that a user may not reassign a row's user_id to somebody else.

-- ─── profiles ───────────────────────────────────────────────────────────────

-- Deliberately NOT the uniform four. There is no insert policy because
-- handle_new_user() creates the row as a security definer trigger, and no
-- delete policy because deleting a profile would orphan the user against a
-- surviving auth.users row that will never fire the trigger again. Profiles
-- disappear when the auth user does, by cascade.
create policy "owner reads" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);

create policy "owner updates" on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- ─── provider_keys ──────────────────────────────────────────────────────────

-- Note what select grants here: RLS is row-level, not column-level, so an owner
-- can read their own ciphertext, iv and auth_tag through PostgREST. Accepted —
-- it is their own key material and is undecryptable without ENCRYPTION_KEY,
-- which never leaves the server. A column-level revoke would close it and break
-- getDecryptedKey() (F13), which must use the user-scoped client because the
-- service-role client is reserved for quota.ts.
create policy "owner reads" on public.provider_keys
  for select to authenticated using ((select auth.uid()) = user_id);

create policy "owner writes" on public.provider_keys
  for insert to authenticated with check ((select auth.uid()) = user_id);

create policy "owner updates" on public.provider_keys
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "owner deletes" on public.provider_keys
  for delete to authenticated using ((select auth.uid()) = user_id);

-- ─── conversations ──────────────────────────────────────────────────────────

create policy "owner reads" on public.conversations
  for select to authenticated using ((select auth.uid()) = user_id);

create policy "owner writes" on public.conversations
  for insert to authenticated with check ((select auth.uid()) = user_id);

create policy "owner updates" on public.conversations
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "owner deletes" on public.conversations
  for delete to authenticated using ((select auth.uid()) = user_id);

-- ─── messages ───────────────────────────────────────────────────────────────

-- delete is needed by edit-and-resend (F19), which truncates the thread, and by
-- regenerate (F20), which removes the previous assistant message.
create policy "owner reads" on public.messages
  for select to authenticated using ((select auth.uid()) = user_id);

create policy "owner writes" on public.messages
  for insert to authenticated with check ((select auth.uid()) = user_id);

create policy "owner updates" on public.messages
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "owner deletes" on public.messages
  for delete to authenticated using ((select auth.uid()) = user_id);

-- ─── attachments ────────────────────────────────────────────────────────────

create policy "owner reads" on public.attachments
  for select to authenticated using ((select auth.uid()) = user_id);

create policy "owner writes" on public.attachments
  for insert to authenticated with check ((select auth.uid()) = user_id);

create policy "owner updates" on public.attachments
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "owner deletes" on public.attachments
  for delete to authenticated using ((select auth.uid()) = user_id);

-- ─── prompts ────────────────────────────────────────────────────────────────

create policy "owner reads" on public.prompts
  for select to authenticated using ((select auth.uid()) = user_id);

create policy "owner writes" on public.prompts
  for insert to authenticated with check ((select auth.uid()) = user_id);

create policy "owner updates" on public.prompts
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "owner deletes" on public.prompts
  for delete to authenticated using ((select auth.uid()) = user_id);

-- ─── shared_key_usage ───────────────────────────────────────────────────────

-- insert and update are required because reserve_shared_slot() and
-- release_shared_slot() are security invoker and run under the caller's
-- session. No delete policy: dropping the row is how a user would reset their
-- own daily allowance, which is the one thing this table exists to prevent.
create policy "owner reads" on public.shared_key_usage
  for select to authenticated using ((select auth.uid()) = user_id);

create policy "owner writes" on public.shared_key_usage
  for insert to authenticated with check ((select auth.uid()) = user_id);

create policy "owner updates" on public.shared_key_usage
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ─── shared_key_budget ──────────────────────────────────────────────────────

-- No policy. Not an oversight, and not something feature 03 forgot: it is a
-- global counter with no owner, so there is no auth.uid() to scope one to. RLS
-- enabled with zero policies makes it unreachable through the anon key by
-- construction. Its permanent rls_enabled_no_policy advisor notice is correct.

-- ─── Public share links ─────────────────────────────────────────────────────

-- Sharing stays inside RLS rather than bypassing it with a service-role client,
-- which is why /share/[slug] can be a plain anonymous read. A non-null
-- share_slug IS the shared state, so revocation takes effect the instant the
-- column is nulled — no cache to invalidate, no second flag to keep in sync.
create policy "anon reads shared conversations" on public.conversations
  for select to anon using (share_slug is not null);

create policy "anon reads shared messages" on public.messages
  for select to anon using (
    exists (
      select 1
        from public.conversations c
       where c.id = messages.conversation_id
         and c.share_slug is not null
    )
  );
