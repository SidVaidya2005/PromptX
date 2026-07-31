-- The attachments bucket and its object policies.
--
-- Private, permanently. The only ways to read a private object are a signed URL
-- generated server-side or a request carrying the owner's JWT, which is exactly
-- the access model architecture.md specifies. Making it public would bypass
-- every policy below for reads.
--
-- Storage paths always begin with the owner's user id — {user_id}/{attachment_id}.{ext} —
-- because these policies match on the first path segment and nothing else. A
-- path built any other way is unreachable by its own owner.

insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false);

-- file_size_limit and allowed_mime_types are deliberately left null here, and
-- feature 28 must set them. They matter more than they look: attachment uploads
-- go client-direct to Storage through signed URLs, so application code is never
-- in the byte path. Checking mime and size when ISSUING the signed URL does not
-- constrain what actually lands — bucket-level limits are the only thing that
-- enforces MAX_ATTACHMENT_BYTES at the moment of upload.

create policy "owner reads attachment objects" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

create policy "owner writes attachment objects" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

-- Needed for upsert, which Storage implements as insert + update.
create policy "owner updates attachment objects" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  )
  with check (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

-- Deleting an attachment removes three objects — storage_path, thumb_path and
-- inline_path — and all three live under the same first path segment, so this
-- one policy covers the whole cleanup.
create policy "owner deletes attachment objects" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );
