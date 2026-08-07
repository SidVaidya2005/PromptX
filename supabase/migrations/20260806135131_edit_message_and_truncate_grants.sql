-- Match edit_message_and_truncate's grants to the other invoker-rights
-- functions in this schema.
--
-- Postgres grants execute on a new function to `public` by default, which on a
-- Supabase project means `anon` can call it. Nothing is actually reachable that
-- way — the owner policies on `messages` are `to authenticated`, so an anon
-- caller matches no row and the function returns null — but "it happens to be
-- harmless" is a worse guarantee than "it is not callable", and the quota
-- functions in 20260805062649_shared_key_quota.sql already set the precedent:
-- revoke from public, grant to the one role that needs it.
--
-- A separate migration rather than an edit to the one before it, because that
-- one is already applied. Forward-only, like 20260731065531 was for pg_net.

revoke execute on function public.edit_message_and_truncate(uuid, text) from public;
revoke execute on function public.edit_message_and_truncate(uuid, text) from anon;

grant execute on function public.edit_message_and_truncate(uuid, text) to authenticated;
