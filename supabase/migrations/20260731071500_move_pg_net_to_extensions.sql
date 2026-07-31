-- `create extension pg_net` without a schema clause registers the extension
-- into `public`, which Supabase's security linter flags as extension_in_public
-- (WARN). Extensions belong in the `extensions` schema; a public one widens the
-- surface reachable through PostgREST.
--
-- Recreated rather than moved: pg_net publishes its callable surface in its own
-- `net` schema, and ALTER EXTENSION ... SET SCHEMA on a partially relocatable
-- extension is the kind of thing that either errors or half-succeeds. There is
-- no in-flight request data to lose — nothing has called net.http_post yet, and
-- the hourly reaper short-circuits on absent Vault secrets until feature 28.
--
-- public.reap_attachments_tick() keeps calling net.http_post: plpgsql resolves
-- names at runtime, and the net schema is unchanged by this.

drop extension if exists pg_net;
create extension pg_net with schema extensions;
