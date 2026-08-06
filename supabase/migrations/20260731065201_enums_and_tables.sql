-- PromptX schema: enums, tables, indexes, the profile trigger, and the budget
-- singleton. Transcribed from context/architecture.md → Data Model.
--
-- Row-Level Security is ENABLED here but no policy is defined. That combination
-- is deny-all for anon and authenticated, which is deliberate: this database is
-- internet-reachable the moment it exists, and feature 03 writes the policies.
-- Enabling RLS in the same migration that creates the table is a stated
-- invariant in architecture.md.

-- ─── Enums ──────────────────────────────────────────────────────────────────

create type public.provider as enum ('openai', 'anthropic', 'google', 'openrouter');
create type public.message_role as enum ('user', 'assistant');
create type public.message_status as enum ('streaming', 'complete', 'error');

-- ─── profiles ───────────────────────────────────────────────────────────────

create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text not null,
  display_name text,
  avatar_url   text,
  created_at   timestamptz not null default now()
);

comment on table public.profiles is
  'One row per authenticated user. Created by the on_auth_user_created trigger, never by application code.';

alter table public.profiles enable row level security;

-- ─── provider_keys ──────────────────────────────────────────────────────────

create table public.provider_keys (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  provider     public.provider not null,
  ciphertext   bytea not null,
  iv           bytea not null,
  auth_tag     bytea not null,
  last_four    text not null,
  label        text,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,

  -- One key per provider per user; adding a second replaces the first.
  -- Doubles as the index covering the user_id foreign key.
  constraint provider_keys_user_provider_key unique (user_id, provider)
);

comment on column public.provider_keys.ciphertext is
  'AES-256-GCM output. Never selected into a client response — last_four is the only key material that may leave the server.';

alter table public.provider_keys enable row level security;

-- ─── conversations ──────────────────────────────────────────────────────────

create table public.conversations (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  title         text not null default 'New chat',
  provider      public.provider not null,
  model_id      text not null,
  system_prompt text,
  pinned_at     timestamptz,
  archived_at   timestamptz,
  share_slug    text unique,
  shared_at     timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on column public.conversations.share_slug is
  'A non-null slug IS the shared state — there is no separate boolean, because two sources of truth for one fact drift apart. Revoking nulls this and shared_at; re-sharing mints a new slug.';

-- The sidebar query: pinned first, then most recently touched. user_id is the
-- leftmost column, so this also covers the user_id foreign key.
create index conversations_sidebar_idx
  on public.conversations (user_id, pinned_at desc nulls last, updated_at desc);

alter table public.conversations enable row level security;

-- ─── messages ───────────────────────────────────────────────────────────────

create table public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  -- Denormalised so the RLS policy in feature 03 needs no join.
  user_id         uuid not null references auth.users (id) on delete cascade,
  role            public.message_role not null,
  content         text not null,
  provider        public.provider,
  model_id        text,
  used_shared_key boolean not null default false,
  input_tokens    integer,
  output_tokens   integer,
  status          public.message_status not null default 'complete',
  error_message   text,
  search_vector   tsvector generated always as (to_tsvector('english', content)) stored,
  created_at      timestamptz not null default now()
);

comment on table public.messages is
  'A strictly ordered flat list. No parent_id, branch, or variant column may be added — the compare view exists precisely so this stays true.';

-- Thread reads. conversation_id leftmost, so this covers that foreign key.
create index messages_thread_idx on public.messages (conversation_id, created_at);

-- Full-text search (feature 26).
create index messages_search_idx on public.messages using gin (search_vector);

-- Not covered by either index above. Needed by the feature 03 RLS policy, by
-- the quota reconciliation sweep, and by the auth.users cascade.
create index messages_user_id_idx on public.messages (user_id);

alter table public.messages enable row level security;

-- ─── attachments ────────────────────────────────────────────────────────────

create table public.attachments (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  -- Null while the upload is still a draft; linked when the message is sent.
  message_id   uuid references public.messages (id) on delete cascade,
  position     smallint not null default 0,
  storage_path text not null,
  thumb_path   text,
  inline_path  text,
  mime_type    text not null,
  size_bytes   integer not null,
  status       text not null default 'pending'
                 constraint attachments_status_check
                 check (status in ('pending', 'ready', 'failed')),
  created_at   timestamptz not null default now()
);

comment on column public.attachments.thumb_path is
  'An image attachment is three storage objects. Every path that deletes an attachment must delete storage_path, thumb_path and inline_path — a cleanup that only knows about the original strands two objects per image.';

-- Ordering within a message is stable and cannot collide. Also covers the
-- message_id foreign key for every row that has one.
create unique index attachments_message_position_idx
  on public.attachments (message_id, position)
  where message_id is not null;

create index attachments_user_id_idx on public.attachments (user_id);

alter table public.attachments enable row level security;

-- ─── prompts ────────────────────────────────────────────────────────────────

create table public.prompts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  title      text not null,
  body       text not null,
  tags       text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index prompts_user_id_idx on public.prompts (user_id);
create index prompts_tags_idx on public.prompts using gin (tags);

alter table public.prompts enable row level security;

-- ─── shared_key_usage ───────────────────────────────────────────────────────

create table public.shared_key_usage (
  user_id       uuid not null references auth.users (id) on delete cascade,
  usage_date    date not null,
  message_count integer not null default 0,
  input_tokens  bigint not null default 0,
  output_tokens bigint not null default 0,
  updated_at    timestamptz not null default now(),

  -- user_id leftmost, so this covers the foreign key too.
  primary key (user_id, usage_date)
);

comment on column public.shared_key_usage.updated_at is
  'LOAD-BEARING, not bookkeeping. The reconciliation sweep treats a row untouched for 5 minutes as holding an orphaned reservation. Every quota function — reserve, release, and token reconciliation — must touch this, or the sweep starts releasing live reservations.';

alter table public.shared_key_usage enable row level security;

-- ─── shared_key_budget ──────────────────────────────────────────────────────

create table public.shared_key_budget (
  id            integer primary key constraint shared_key_budget_singleton check (id = 1),
  period_month  date not null,
  input_tokens  bigint not null default 0,
  output_tokens bigint not null default 0,
  estimated_usd numeric(10, 4) not null default 0,
  tripped_at    timestamptz
);

comment on table public.shared_key_budget is
  'A global operational counter with no owner, so there is no auth.uid() to scope it to. RLS is enabled and NO policy is defined for any role — not even in feature 03 — which makes it unreachable through the anon key by construction. Only the service-role client in src/server/quota.ts may touch it.';

comment on column public.shared_key_budget.estimated_usd is
  'Derived from MEASURED tokens only. A call that fails without reporting usage records nothing — an estimate must never enter the ledger that drives a circuit breaker.';

alter table public.shared_key_budget enable row level security;

-- The singleton row, seeded for the current UTC accounting month.
insert into public.shared_key_budget (id, period_month)
values (1, date_trunc('month', now() at time zone 'utc')::date);

-- ─── Profile creation trigger ───────────────────────────────────────────────

-- SECURITY DEFINER is required here and is the one sanctioned use in this
-- codebase: the function is fired by an insert on auth.users, executes as the
-- auth admin role, and must write into public.profiles. The reason is recorded
-- in constraints.md → Database access, as library-docs.md requires.
--
-- search_path is emptied and every name fully qualified, so a schema planted on
-- the caller's search_path cannot hijack the elevated execution.
--
-- Supabase's own caution applies: a trigger that raises BLOCKS SIGNUP. Hence
-- the coalesce chain over the Google identity's metadata keys and the
-- on-conflict guard, so a repeat insert or an unexpected metadata shape cannot
-- lock a user out. The exact keys are confirmed against a real Google sign-in
-- in feature 04.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, display_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      split_part(new.email, '@', 1)
    ),
    coalesce(
      new.raw_user_meta_data ->> 'avatar_url',
      new.raw_user_meta_data ->> 'picture'
    )
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

-- Nothing but the trigger may invoke an elevated function.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
