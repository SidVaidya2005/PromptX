-- Attachment metadata for a shared conversation. (F33)
--
-- F03 wrote anon read policies for `conversations` and `messages` and none for
-- `attachments`, which was correct at the time: nothing rendered a shared
-- conversation yet, and the table was empty until F28. The consequence only
-- surfaces now — §33 asks for "attachments shown as placeholders", and a reader
-- who cannot see the ROW cannot be told a file was ever there. The message would
-- simply appear to have been sent with nothing attached, which is the failure
-- mode that looks like the application working.
--
-- **Metadata only, and the distinction is the whole policy.** This exposes
-- mime_type, size_bytes and position to anyone holding the link. It does NOT
-- expose the bytes: the `attachments` bucket is private and its storage policies
-- stay owner-scoped, so no anonymous reader can fetch an object — and the share
-- page must never call the signed-URL helper, which is the one thing that could
-- hand them a readable link. That is the line the placeholder exists to keep.
--
-- A draft attachment is unreachable by construction rather than by a clause:
-- `message_id` is null until the message is sent, so the `exists` below matches
-- nothing for an upload that never became part of a conversation.
--
-- Scoped through the message to its conversation, exactly as the `messages`
-- policy is scoped through the conversation. Revocation therefore reaches this
-- for free: nulling `share_slug` closes all three at once, because all three ask
-- the same question of the same column.

create policy "anon reads shared attachments" on public.attachments
  for select to anon using (
    exists (
      select 1
        from public.messages m
        join public.conversations c on c.id = m.conversation_id
       where m.id = attachments.message_id
         and c.share_slug is not null
    )
  );
