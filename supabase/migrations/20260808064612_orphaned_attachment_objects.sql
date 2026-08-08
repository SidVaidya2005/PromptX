-- Finds storage objects that no attachments row points at.
--
-- This is the second half of the reaper, and it exists for a leak nothing else
-- can reach. Deleting a conversation cascades to its messages and from there to
-- their attachment rows — but a cascade is SQL, and SQL cannot delete a storage
-- object. The files survive with nothing left in the database naming them, so
-- the orphan-ROW sweep can never find them: there is no row to find.
--
-- It reads storage.objects and deletes nothing. Deletion goes through the
-- Storage API in the Edge Function, which is the whole reason that function
-- exists — `delete from storage.objects` removes the metadata and strands the
-- file permanently, manufacturing the exact leak this is written to clean up.
--
-- A function rather than a query in the Edge Function, because PostgREST exposes
-- only `public` and `graphql_public`: `.schema('storage').from('objects')` is
-- not reachable from a supabase-js client at all.
--
-- security invoker, like every other function here except handle_new_user().
-- The caller is the service-role client inside the Edge Function, which has
-- BYPASSRLS, so invoker rights plus a privileged caller is sufficient and no
-- elevation is needed. constraints.md requires a written reason for
-- `security definer`; there is none here.
create function public.orphaned_attachment_objects(
  p_older_than interval,
  p_limit      int
)
returns table (object_name text)
language sql
security invoker
set search_path = public
as $$
  with known as (
    select a.storage_path as path from public.attachments a
    union
    select a.thumb_path   from public.attachments a where a.thumb_path  is not null
    union
    select a.inline_path  from public.attachments a where a.inline_path is not null
  )
  select o.name
    from storage.objects o
   where o.bucket_id = 'attachments'
     -- THE SAFETY BOUND. An object is uploaded seconds after its row is created
     -- but the row records no path until the upload URL is issued and the client
     -- has finished; without this, a sweep landing mid-upload deletes a file
     -- someone is still writing. Nothing here is urgent, so the bound is
     -- generous — the caller passes ATTACHMENT_ORPHAN_TTL_HOURS.
     and o.created_at < now() - p_older_than
     -- `not exists` rather than `not in`: a null anywhere in a `not in` subquery
     -- makes the whole predicate return nothing, which would silently turn this
     -- into a function that never reaps. thumb_path and inline_path are null for
     -- every PDF, so that is not a hypothetical.
     and not exists (select 1 from known k where k.path = o.name)
   order by o.created_at
   limit p_limit;
$$;

-- Reachable only by the service-role client inside the Edge Function. Postgres
-- grants execute to `public` by default, which is what the second F19 migration
-- had to correct after the fact.
revoke execute on function public.orphaned_attachment_objects(interval, int)
  from public, anon, authenticated;
grant execute on function public.orphaned_attachment_objects(interval, int)
  to service_role;
