-- Match the search functions' grants to every other invoker-rights function in
-- this schema. (F26)
--
-- Postgres grants execute on a new function to `public` by default, which on a
-- Supabase project means `anon` can call it. For `search_messages` that is
-- genuinely harmless — it is `security invoker`, and the owner policies on
-- `messages` are `to authenticated`, so an anon caller matches no row and gets
-- an empty set. But "it happens to return nothing" is a worse guarantee than
-- "it is not callable", and F19 established the precedent after the quota
-- functions set it.
--
-- `search_has_terms` touches no table at all, so nothing about RLS protects it.
-- It is revoked for the same reason: an endpoint that answers questions about
-- the server's stopword list is not something to leave open to anonymous
-- callers by accident.
--
-- A separate migration rather than an edit to the one before it, because that
-- one is already applied. Forward-only, as 20260731065531 and
-- 20260806135131 were.

revoke execute on function public.search_messages(text, int) from public;
revoke execute on function public.search_messages(text, int) from anon;
grant execute on function public.search_messages(text, int) to authenticated;

revoke execute on function public.search_has_terms(text) from public;
revoke execute on function public.search_has_terms(text) from anon;
grant execute on function public.search_has_terms(text) to authenticated;
