-- Links ready drafts to the message that was just written, in one statement.
--
-- A database function for the reason F19's edit_message_and_truncate is one:
-- PostgREST cannot span a transaction, and four separate updates can fail in the
-- middle. A message that permanently shows two of its four attachments is not a
-- state anything downstream can repair — the other two stay drafts and are
-- reaped a day later, so the evidence disappears too.
--
-- It also closes a window the route could not. /api/chat proves the rows are
-- ready and unlinked ABOVE the "will reach a provider" line and links them
-- below it, which leaves a gap where a concurrent request could link the same
-- draft to a different message. Repeating both conditions in the update's own
-- `where` makes the check and the write the same statement — the shape F16's
-- quota claim uses, for the same reason.
--
-- `position` comes from the ordinality of p_ids, so the order is the one the
-- composer last showed rather than anything stored on the draft. That is what
-- makes attachments_message_position_idx (unique over message_id, position)
-- safe: every row in one call gets a distinct index, and a draft carries no
-- position anyone could have chosen twice.
--
-- security invoker. RLS is what scopes every part of this: the owner-update
-- policy on attachments decides which drafts can move, and the owner-read
-- policy on messages is why the `exists` below needs no user_id comparison of
-- its own — someone else's message id simply does not exist from in here.
create function public.link_attachments_to_message(
  p_message_id uuid,
  p_ids        uuid[]
)
returns integer
language sql
security invoker
set search_path = public
as $$
  with ordered as (
    select t.id, t.ord
      from unnest(p_ids) with ordinality as t(id, ord)
  ),
  updated as (
    update public.attachments a
       set message_id = p_message_id,
           position   = (o.ord - 1)::smallint
      from ordered o
     where a.id         = o.id
       and a.message_id is null
       and a.status     = 'ready'
       and exists (select 1 from public.messages m where m.id = p_message_id)
    returning a.id
  )
  -- The caller compares this against the number of ids it sent. Fewer means a
  -- draft stopped being linkable between the check and the write, which is a
  -- failure rather than a partial success: /api/chat throws, refunds the shared
  -- slot, and reports that the message could not be sent.
  select count(*)::int from updated;
$$;

revoke execute on function public.link_attachments_to_message(uuid, uuid[])
  from public, anon;
grant execute on function public.link_attachments_to_message(uuid, uuid[])
  to authenticated;
