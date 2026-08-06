-- Editing a prompt, and everything that followed it.
--
-- One function, and the reason it is a function at all is that PostgREST cannot
-- span a transaction (F07). Split into two supabase-js calls — update the
-- content, then delete the rest — a failure between them leaves an edited prompt
-- still followed by the answer to the question it used to be. The thread would
-- then misrepresent itself, which is worse than either half failing outright.
--
-- `security invoker`, like the quota functions in
-- 20260805120000_shared_key_quota.sql and unlike `handle_new_user()`. It runs
-- under the caller's session, so the owner policies on `messages` are what stop
-- one user editing another's prompt. There is no elevation here and none is
-- needed: every row this touches is already reachable by the caller.
--
-- ─── On ordering ─────────────────────────────────────────────────────────────
--
-- "Every message after this one" needs a definition of *after*, and until this
-- migration the thread did not have a total one. `messages_thread_idx` and
-- `listByConversation()` both order on `created_at` alone, which is unique in
-- practice — the user row and the assistant row of one exchange are separate
-- PostgREST calls, so separate transactions, so different `now()` — but nothing
-- enforces it. On a tie the display order is arbitrary, and a truncation that
-- guessed differently from the query would either strand an answer above the
-- prompt it no longer belongs to, or delete a row that was actually earlier.
--
-- So the order becomes total: `(created_at, id)`. The tiebreaker is arbitrary —
-- `id` is a random uuid — but it is *consistent*, and consistency is the whole
-- requirement. This predicate and `listByConversation()`'s ORDER BY must stay in
-- step; they are two halves of one rule and there is no third place to change.

create function public.edit_message_and_truncate(
  p_message_id uuid,
  p_content text
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_conversation_id uuid;
  v_created_at      timestamptz;
  v_removed         integer;
begin
  -- The update is also the ownership check. RLS filters the row out for anyone
  -- but its owner, so someone else's message matches nothing and this returns
  -- null — the same answer as "no such message", which is correct for both:
  -- confirming that an id exists but is not yours is itself a disclosure.
  --
  -- `role = 'user'` is the other half. An assistant message is a record of what
  -- a model actually produced, and `architecture.md` requires it stay that way;
  -- rewriting one would make the thread a transcript of something that never
  -- happened.
  update public.messages
     set content = p_content
   where id = p_message_id
     and role = 'user'
  returning conversation_id, created_at
    into v_conversation_id, v_created_at;

  if not found then
    return null;
  end if;

  -- Row-wise comparison, matching listByConversation()'s ORDER BY exactly. The
  -- leading column is still `created_at`, so messages_thread_idx applies.
  delete from public.messages
   where conversation_id = v_conversation_id
     and (created_at, id) > (v_created_at, p_message_id);

  get diagnostics v_removed = row_count;

  return v_removed;
end;
$$;

comment on function public.edit_message_and_truncate(uuid, text) is
  'Replaces a user message''s content and deletes every message after it in the same conversation, in one transaction. Returns the number of rows removed, or null when the message does not exist, is not the caller''s, or is not a user message. Ordering is (created_at, id) and must match listByConversation().';
