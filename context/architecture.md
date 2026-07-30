# Architecture

> **Role:** How the system is built — stack, structure, boundaries, data, and the invariants that must never be violated.
> **Read after** `project-overview.md`, before writing any code.
> **Relates to:** the stack here drives `code-standards.md` and `library-docs.md`.

## Stack

| Layer | Tool | Purpose |
| ----- | ---- | ------- |
| Language | TypeScript 5.1+ (`strict: true`) | Every file. No JavaScript source files. |
| Framework | Next.js 16 (App Router, React 19.2) | Routing, Server Components, route handlers, streaming. Turbopack is the default builder |
| Runtime | Node.js 20.9+ | Route handlers run on the Node runtime, not Edge — the vault needs `node:crypto` |
| Database | Supabase Postgres | All relational data; Row-Level Security is the isolation boundary |
| Auth | Supabase Auth (Google OAuth) | The only sign-in method. Sessions are cookie-based via `@supabase/ssr@^0.12` — pre-1.0, so the minor is pinned: its cookie API has broken across minors before |
| Object storage | Supabase Storage | Image and PDF attachments, private bucket |
| Search | Postgres full-text search (`tsvector` + GIN) | Ranked message search. No external search service |
| Scheduled jobs | `pg_cron` + `pg_net` (Postgres extensions) | Quota reconciliation (every 10 min, pure SQL) and attachment reaping (hourly, via an Edge Function — storage objects cannot be deleted from SQL). Render Cron Jobs are a paid service type unavailable on the free tier |
| Edge Function | Supabase Functions (Deno) | One function, `reap-attachments`. Exists solely because deleting a `storage.objects` row does not delete the file — object removal must go through the Storage API |
| AI orchestration | Vercel AI SDK v7 (`ai@^7`) | `streamText`, UI message streaming, unified provider interface |
| AI providers | `@ai-sdk/openai@^4`, `@ai-sdk/anthropic@^4`, `@ai-sdk/google@^4`, `@openrouter/ai-sdk-provider@^3` | The four supported BYOK providers |
| Shared model | Gemini Flash via `@ai-sdk/google` | The fallback for users without a key, quota-enforced |
| Secret encryption | `node:crypto` AES-256-GCM | Encrypts user API keys at rest. No third-party crypto dependency |
| Styling | Tailwind CSS v4 | Design tokens declared in `@theme` from `DESIGN.md` |
| Components | shadcn/ui (Radix primitives) | Accessible unstyled primitives, restyled to the PromptX tokens |
| Markdown | `react-markdown` + `remark-gfm` + `shiki` | Assistant message rendering and code highlighting |
| Validation | `zod@^4` | Every route handler input and every environment variable |
| Unit tests | Vitest | Server logic: vault, quota, provider resolution, data access |
| E2E tests | Playwright | Four critical paths, run against a local Supabase instance |
| Hosting | Render (Web Service, Node) | Production deployment. A long-running Node process, not serverless — see "Hosting model" below |
| Analytics | None | The project ships no analytics or telemetry |

---

## Hosting model

PromptX runs on **Render as a single Node Web Service** — one long-lived process
serving `next start`. It is not a serverless deployment, and several consequences
follow that are easy to get wrong if you port advice written for Vercel.

**Render hosts the app. Supabase hosts everything else.** The database, auth,
storage, and `pg_cron` all live in Supabase. Render's own Postgres and Key Value
offerings are not used — do not provision them.

| Concern | On Render | Why it matters here |
| --- | --- | --- |
| Request duration | **100 minutes** maximum | Streaming is unconstrained in practice. The real limit on a response is the provider's own timeout, not the host's. |
| `export const maxDuration` | **No effect** | A Vercel-only directive. Harmless but misleading — it is not what keeps a stream alive here. |
| Runtime | Node, always | There is no Edge runtime to accidentally opt into, so `node:crypto` in the vault is never at risk. `export const runtime = 'nodejs'` is kept as documentation of intent, not as a guard. |
| Process lifetime | Long-lived | In-memory caches (the shiki highlighter) genuinely persist across requests instead of being rebuilt per invocation. |
| Scheduled jobs | Paid service type | Unavailable on free, which is why both jobs run in `pg_cron` inside Supabase. |
| Idle behaviour | **Free services spin down after 15 minutes**, ~1 minute cold start | The single biggest deployment decision — see below. |
| Instances | One, no autoscaling on free | Fine at this scale; the atomic quota reservation is still required, because concurrency exists within a single process. |

### The cold-start problem

A free Render service sleeps after 15 minutes of no traffic and takes roughly a
minute to wake. For a portfolio piece whose whole purpose is that someone opens
the link and forms an impression, a blank minute is the worst possible first
frame — and it lands on the exact visitor the project is for.

Three ways out, in order of honesty:

1. **Pay for a Starter instance (~$7/month).** No spin-down, no cold start. If this project is going in a job application, this is the option that matches the goal.
2. **Accept it, and make the wait legible.** Render serves a loading page during wake; the landing page should not pretend the app is instant. Cheapest, and defensible for a side project.
3. **Keep it warm with an external pinger.** A month is at most 744 hours and the free allowance is 750, so one always-on service technically fits. It is against the spirit of the free tier, leaves no headroom for a second service, and Render may treat it as abuse. Documented for completeness, not recommended.

**Decided: option 2 — free tier, cold start accepted.** That makes the ~60s wake
a design constraint rather than a bug, and it is the dominant performance fact
about this deployment. Two consequences bind the build:

- **The landing page must survive being the slow one.** It is the first thing a waking instance serves, so it carries no client-side data fetch, no above-the-fold image, and nothing that defers meaningful paint. Once the process is up it should be effectively instant, because everything else about the visit already cost a minute.
- **Nothing may be optimised on the assumption of a warm process.** In-memory caches (the shiki highlighter) are still worth having — they help every request after the first — but no correctness or UX decision may depend on the process having been alive a moment ago.

Revisit this if the project goes into an application; upgrading is a dashboard
change with no code impact.

### Region

Put the Render service in the region closest to the Supabase project. Every
request performs an auth check and at least one query, so a cross-continent hop
is paid on every page load, twice.

### Deploy triggers

The service's `rootDir` is `.` and stays there. This repo is a single Next
application at the top level, not a monorepo — `rootDir` excludes everything
outside it from both build and runtime, so pointing it at a subdirectory would
strand `package.json` and fail the build.

What is worth configuring is **which commits trigger a deploy**. Roughly half
this repo is documentation the running service never reads, and on the free tier
every deploy restarts the process — handing the next visitor a cold start for a
change that altered no runtime behaviour. `render.yaml` therefore carries:

```yaml
buildFilter:
  ignored:
    - context/**
    - "*.md"
    - .claude/**
```

Ignore-lists only. An `included` list fails open in the wrong direction: any path
nobody thought to list silently stops deploying, and the symptom is a real fix
that never shipped. Filter paths are relative to the repository root regardless
of `rootDir`, and a synced `buildFilter` fully replaces the service's existing
settings rather than merging with them.

### No CDN

**Decided: the Render origin serves everything, including `/_next/static`.** No
Cloudflare, no proxy in front. The tradeoff is accepted deliberately: a proxy
that buffers responses would break SSE streaming, which is the core interaction
here, and that risk outweighs faster first-load static assets at this traffic
level.

What this means in practice:

- Static assets are content-hashed and immutable, so Next's own `Cache-Control` headers still make repeat visits fast. The cost is paid by first-time visitors far from the region, and only once.
- Compression is gzip, from `next start`. There is no brotli, because nothing in front of the origin can add it.
- **Payload size matters more than it would behind a CDN.** There is no edge to absorb a heavy bundle — every byte is served from one origin, in one region, by the same process handling streams.

Revisit only if measurement shows static-asset latency is a real problem. If a
CDN is ever added, `/api/*` must bypass it entirely — a cached or buffered
streaming response is a broken streaming response.

---

## Folder Structure

```
PromptX/
├── CLAUDE.md                       → agent entry point, points at context/
├── render.yaml                     → Render Blueprint: service, build/start commands,
│                                     health check, region, env var declarations
├── context/                        → project documentation (this folder)
│   ├── DESIGN.md                   → the design system. Source of truth for all visual tokens
│   ├── project-overview.md
│   ├── architecture.md
│   ├── code-standards.md
│   ├── library-docs.md
│   ├── build-plan.md
│   ├── progress-tracker.md
│   └── build-journal.md
├── src/
│   ├── app/                        → routes ONLY. No business logic.
│   │   ├── layout.tsx              → html/body, font loading, global providers
│   │   ├── globals.css             → Tailwind v4 @theme token declarations
│   │   ├── page.tsx                → landing / signed-out entry
│   │   ├── (app)/                  → authenticated route group
│   │   │   ├── layout.tsx          → three-column shell; enforces the session
│   │   │   ├── chat/
│   │   │   │   ├── page.tsx        → new conversation
│   │   │   │   └── [id]/page.tsx   → conversation thread
│   │   │   ├── compare/page.tsx
│   │   │   ├── prompts/page.tsx
│   │   │   ├── search/page.tsx
│   │   │   └── settings/
│   │   │       ├── keys/page.tsx
│   │   │       └── account/page.tsx
│   │   ├── share/[slug]/page.tsx   → public read-only conversation
│   │   ├── auth/
│   │   │   ├── callback/route.ts   → OAuth code exchange
│   │   │   └── signout/route.ts
│   │   └── api/
│   │       ├── chat/route.ts       → streaming chat completion
│   │       ├── compare/route.ts    → two-model streaming comparison
│   │       ├── title/route.ts      → background conversation titling
│   │       ├── keys/route.ts       → add / replace / delete a provider key
│   │       └── health/route.ts     → Render health check target. No auth, no DB read.
│   ├── components/                 → React components. Presentation only.
│   │   ├── ui/                     → shadcn primitives, restyled to PromptX tokens
│   │   ├── chat/                   → thread, message, composer, outline rail, model picker
│   │   ├── sidebar/                → conversation list, grouping, search entry
│   │   ├── prompts/                → prompt library cards and editor
│   │   └── settings/               → key management forms, quota meter
│   ├── server/                     → SERVER-ONLY modules. Never imported by a Client Component.
│   │   ├── env.ts                  → zod-validated SECRET env vars. Read at boot.
│   │   ├── supabase.ts             → server + service-role Supabase clients
│   │   ├── auth.ts                 → requireUser() session guard
│   │   ├── vault.ts                → AES-256-GCM encrypt / decrypt for provider keys
│   │   ├── keys.ts                 → store, read, and resolve a user's provider key
│   │   ├── providers.ts            → resolveModel(): provider + key → AI SDK model
│   │   ├── quota.ts                → shared-key daily allowance + global circuit breaker
│   │   └── data/                   → all database access, one module per table
│   │       ├── conversations.ts
│   │       ├── messages.ts
│   │       ├── prompts.ts
│   │       └── attachments.ts
│   ├── lib/                        → isomorphic. Safe to import from anywhere.
│   │   ├── supabase-browser.ts     → createBrowserClient
│   │   ├── models.ts               → the model catalog and capability flags
│   │   ├── constants.ts            → shared limits and thresholds (PUBLIC config only)
│   │   ├── schemas.ts              → zod schemas shared by client and server
│   │   └── utils.ts                → cn() and small pure helpers
│   ├── types/
│   │   ├── database.ts             → generated from the Supabase schema
│   │   └── domain.ts               → hand-written application types
│   └── proxy.ts                    → Supabase session refresh on every request
│                                     (Next.js 16 renamed middleware.ts → proxy.ts)
├── supabase/
│   ├── migrations/                 → timestamped SQL migrations, the schema source of truth
│   ├── functions/
│   │   └── reap-attachments/       → deletes orphaned storage objects, then their rows
│   └── seed.sql                    → local development seed data
├── tests/                          → Vitest unit tests, mirroring src/server/
└── e2e/                            → Playwright specs
```

---

## System Boundaries

| Folder | Owns |
| ------ | ---- |
| `src/app/` | Routing, page composition, and route handlers. Owns *no* business logic — a route handler parses input, calls into `src/server/`, and shapes the response. No direct Supabase queries, no `streamText` call assembled inline, no encryption. |
| `src/components/` | Rendering and local interaction state. May call route handlers via `fetch` and receive data as props from Server Components. Must never import from `src/server/`, never construct a Supabase client other than the browser one, and never contain a SQL query or a provider SDK call. |
| `src/server/` | Every privileged operation: database access, decryption, quota accounting, provider instantiation, and **all secret environment variables** (`src/server/env.ts`). Every file begins with `import 'server-only'`. This is the only place a service-role client or a plaintext API key may exist. |
| `src/server/data/` | The *only* place Supabase queries are written. One module per table, exporting named functions that take an authenticated client. No other folder may call `.from()`. |
| `src/lib/` | Pure, dependency-light helpers safe in both runtimes: the model catalog, shared zod schemas, formatting, and **public** configuration only. `src/lib/constants.ts` may read `NEXT_PUBLIC_*` variables and non-secret tuning values (quota limits, size caps); it must never touch `ENCRYPTION_KEY`, `SUPABASE_SECRET_KEY`, or `SHARED_GEMINI_API_KEY` — those live in `src/server/env.ts`. Must never import from `src/server/`. |
| `src/proxy.ts` | Session-cookie refresh only. Next.js 16 renamed `middleware.ts` → `proxy.ts` and the export from `middleware` to `proxy`; its runtime is always `nodejs` and cannot be configured. It refreshes the session and nothing else — it is never an authorisation check, never queries the database, and holds no business logic. |
| `src/types/` | Type declarations only. No runtime code, no exported values. |
| `supabase/migrations/` | The schema, including tables, indexes, RLS policies, and enums. Schema changes exist here first; nothing is altered through the Supabase dashboard. |
| `tests/` | Vitest unit tests for `src/server/`. Mirrors that folder's structure. |
| `e2e/` | Playwright specs for critical user paths. Owns no application code. |

---

## Data Flow

### Sending a message (BYOK or shared key)

The client sends **only the newest message**, never the whole history — the
server already has the thread, so re-uploading it every turn is waste and lets a
client rewrite its own past.

```
Composer (Client Component)
  │  POST /api/chat  { conversationId, message, provider, modelId }
  ▼                                    ↑ singular. One UIMessage.
src/app/api/chat/route.ts
  │  zod-parse the body
  ├─► requireUser()                    → 401 if no session
  ├─► conversations.getById()          → 404 if absent or not owned (RLS)
  ├─► messages.listByConversation()    → load history server-side
  │
  │   ── EVERY WAY TO FAIL COMES FIRST. Nothing is written until the request
  │      is certain to reach a provider, so a refusal leaves no trace. ──
  ├─► resolveModel(user, provider, modelId)
  │     ├─ user has a key for provider?
  │     │    yes → keys.getDecrypted()  → decrypt in memory, no quota check
  │     │    no  → provider must be 'google' + SHARED_MODEL_ID
  │     │           └─ else → 400 missing_key       (nothing persisted)
  │     └─ shared key path → quota.reserveSharedSlot(userId)
  │            ├─ global circuit breaker tripped?  → 503 budget_exhausted
  │            └─ ATOMIC claim of one slot          → 429 quota_exceeded
  │               (a single conditional upsert — see "Quota reservation" below)
  │
  │   ── PAST THIS LINE the request WILL hit a provider. Now persist. ──
  ├─► appendMessage(role: 'user', status: 'complete')
  └─► appendMessage(role: 'assistant', status: 'streaming', content: '')
        → returns assistantMessageId, held for the duration of the stream
  ▼
streamText({ model, system, messages: history, abortSignal })
  │  UI message stream
  ├─► onFinish:  update assistantMessageId → content, tokens, status='complete'
  │              reconcile token usage into the ledgers
  └─► onError / abort:
         update assistantMessageId → partial content, status='error'
         releaseSharedSlot(userId)     → refund the reserved slot
  ▼
Client renders tokens as they arrive
```

Two ordering rules are doing real work here:

**Refusals write nothing.** Persisting the prompt before quota resolution would
leave a dangling user message with no answer every time someone hit the daily
limit — a thread that looks broken, caused by the app working correctly. The
composer keeps the user's text on a 4xx, so nothing is lost by waiting.

**The assistant row is created up front, in `streaming` status.** This is what
`message_status.streaming` exists for. Without it there is no stable row to
update on failure: at `onError` the most recent message is the *user's*, so any
"mark the last message errored" logic would mark the prompt as failed. Holding
`assistantMessageId` makes both completion and failure a targeted update by
primary key, with no ambiguity about which row is meant.

### Quota reservation (why the slot is claimed, not checked)

Checking the count and incrementing it later is a race: two concurrent requests
at count 19 both read "under the limit", both proceed, and the day ends at 21.
The check and the increment must therefore be **the same statement**.

```
reserveSharedSlot(userId)
  │
  ├─► 1. read shared_key_budget (service role) → tripped_at set? → 503, stop
  │
  └─► 2. ONE atomic statement claims the slot:
         insert into shared_key_usage (user_id, usage_date, message_count)
         values ($1, current_utc_date, 1)
         on conflict (user_id, usage_date) do update
           set message_count = shared_key_usage.message_count + 1
           where shared_key_usage.message_count < $2   ← the limit
         returning message_count

         row returned    → slot claimed, proceed
         NO row returned → limit already reached → 429, stop

releaseSharedSlot(userId)   ← on stream failure or abort
  └─► decrement message_count, floored at 0
```

The `where` clause on the `do update` branch is what closes the window: under
concurrency Postgres serialises the two updates on the same row, and the second
one matches no row and returns nothing.

### Storing a provider key

```
Settings form (Client Component)
  │  POST /api/keys  { provider, apiKey }
  ▼
src/app/api/keys/route.ts
  ├─► requireUser()
  ├─► probe the key with a minimal provider call → 400 if invalid
  ├─► vault.encrypt(apiKey)            → { ciphertext, iv, authTag }
  ├─► keys.upsert(userId, provider, …, lastFour)
  ▼
Response: { provider, lastFour, createdAt }     ← never the key itself
```

### Reading a conversation

```
/chat/[id]/page.tsx (Server Component)
  ├─► createServerSupabaseClient()      → cookie-bound, RLS active
  ├─► conversations.getById(client, id) → null if not owned (RLS filters it)
  ├─► messages.listByConversation(client, id)
  ▼
Props → <Thread /> + <OutlineRail /> (Client Components)
```

### Searching messages

```
/search?q=… (Server Component)
  ├─► requireUser()
  ├─► messages.search(client, query)
  │     websearch_to_tsquery('english', $1) against messages.search_vector
  │     ts_rank ordering, ts_headline for snippets
  │     RLS restricts the scan to the caller's rows
  ▼
Ranked results with highlighted snippets
```

### Viewing a shared conversation

The route is **never cached at any layer**. Revocation must take effect
immediately, and a cached copy of a revoked conversation would defeat the whole
mechanism:

- `export const dynamic = 'force-dynamic'` on the page — no static generation, no ISR.
- `Cache-Control: private, no-store` on the response — no CDN or browser cache.
- The route must not be opted into `cacheComponents`. If that flag is ever enabled project-wide, `/share/[slug]` is explicitly excluded.

```
/share/[slug]/page.tsx (Server Component, no session)
  ├─► anonymous Supabase client
  ├─► select from conversations where share_slug = $1
  │     RLS anon policy permits only rows with a non-null share_slug
  ├─► select messages for that conversation
  │     RLS anon policy permits only messages whose conversation is shared
  ▼
Read-only thread. No composer, no model picker, no owner identity.
```

### Comparing two models

```
/compare (Client Component)
  │  POST /api/compare  { prompt, left: {provider, modelId}, right: {…} }
  ▼
src/app/api/compare/route.ts
  ├─► requireUser()
  ├─► resolveModel() for each side, independently quota-checked
  ├─► two streamText calls, merged into one multiplexed stream tagged left/right
  ▼
Two streaming columns. NOTHING is persisted.
  │
  └─► "Continue with this one" → POST /api/chat creates a real conversation
        seeded with the prompt and the chosen answer
```

---

## Data Model

All tables live in the `public` schema with Row-Level Security enabled. `user_id`
always references `auth.users(id) ON DELETE CASCADE`.

Two enums back the model columns:

```sql
create type provider as enum ('openai', 'anthropic', 'google', 'openrouter');
create type message_role as enum ('user', 'assistant');
create type message_status as enum ('streaming', 'complete', 'error');
```

### `profiles`

| Column | Type | Notes |
| ------ | ---- | ----- |
| `id` | `uuid` PK | References `auth.users(id)`. Not generated — mirrors the auth id |
| `email` | `text` | Not null. Copied from the OAuth identity |
| `display_name` | `text` | From the Google profile, editable |
| `avatar_url` | `text` | From the Google profile |
| `created_at` | `timestamptz` | Default `now()` |

Created by an `on auth.user created` trigger, not by application code.

### `provider_keys`

| Column | Type | Notes |
| ------ | ---- | ----- |
| `id` | `uuid` PK | Default `gen_random_uuid()` |
| `user_id` | `uuid` | Not null, indexed |
| `provider` | `provider` | Not null |
| `ciphertext` | `bytea` | Not null. AES-256-GCM output. **Never selected into a client response** |
| `iv` | `bytea` | Not null. 12 random bytes, unique per encryption |
| `auth_tag` | `bytea` | Not null. 16 bytes |
| `last_four` | `text` | Not null. The only part of the key the UI ever displays |
| `label` | `text` | Optional user-supplied name |
| `created_at` | `timestamptz` | Default `now()` |
| `last_used_at` | `timestamptz` | Touched on each successful completion |

`unique (user_id, provider)` — one key per provider per user; adding a second replaces the first.

### `conversations`

| Column | Type | Notes |
| ------ | ---- | ----- |
| `id` | `uuid` PK | |
| `user_id` | `uuid` | Not null, indexed |
| `title` | `text` | Not null, default `'New chat'`. Replaced by the generated title |
| `provider` | `provider` | Not null. The provider selected for the next message |
| `model_id` | `text` | Not null. Must exist in the catalog in `src/lib/models.ts` |
| `system_prompt` | `text` | Nullable. Prepended to every request in this conversation |
| `pinned_at` | `timestamptz` | Nullable. Non-null sorts the conversation to the top |
| `archived_at` | `timestamptz` | Nullable. Non-null hides it from the default sidebar |
| `share_slug` | `text` | Nullable, `unique`. Non-null makes the conversation publicly readable |
| `shared_at` | `timestamptz` | Nullable. Set alongside `share_slug` |
| `created_at` | `timestamptz` | Default `now()` |
| `updated_at` | `timestamptz` | Touched on every new message |

Index: `(user_id, pinned_at desc nulls last, updated_at desc)` for the sidebar query.

**Share semantics.** `share_slug` being non-null *is* the shared state — there is
no separate boolean, because two sources of truth for one fact drift apart.

- Slugs are `nanoid(12)` from the URL-safe alphabet: ~71 bits of entropy, unguessable by enumeration.
- The `unique` constraint is the collision guard. Generation retries on a unique violation up to 3 times, then fails the request — it must never loop unbounded, and it must never fall back to a non-random slug.
- Revoking sets both `share_slug` and `shared_at` to null. The old URL 404s immediately because the anon RLS policy only matches non-null slugs.
- Re-sharing after revocation mints a **new** slug. The previous URL is never reinstated, so revocation is final from the visitor's perspective.
- `/share/[slug]` is `force-dynamic` and sets `Cache-Control: private, no-store`, so a revoked page cannot be served from a static build, an ISR entry, or an edge cache after the row is nulled.

### `messages`

| Column | Type | Notes |
| ------ | ---- | ----- |
| `id` | `uuid` PK | |
| `conversation_id` | `uuid` | Not null, `on delete cascade` |
| `user_id` | `uuid` | Not null. Denormalised so the RLS policy needs no join |
| `role` | `message_role` | Not null |
| `content` | `text` | Not null |
| `provider` | `provider` | Nullable. Null for user messages |
| `model_id` | `text` | Nullable. Null for user messages. Records what actually answered |
| `used_shared_key` | `boolean` | Not null, default `false` |
| `input_tokens` | `integer` | Nullable |
| `output_tokens` | `integer` | Nullable |
| `status` | `message_status` | Not null, default `'complete'` |
| `error_message` | `text` | Nullable. Set when `status = 'error'` |
| `search_vector` | `tsvector` | `generated always as (to_tsvector('english', content)) stored` |
| `created_at` | `timestamptz` | Default `now()`. Also the thread ordering key |

Indexes: `(conversation_id, created_at)` for thread reads; `gin (search_vector)` for search.

Messages are a strictly ordered flat list. There is no `parent_id`, and none may
be added — the compare view exists precisely so this stays true.

### `attachments`

| Column | Type | Notes |
| ------ | ---- | ----- |
| `id` | `uuid` PK | |
| `user_id` | `uuid` | Not null |
| `message_id` | `uuid` | Nullable, `on delete cascade`. Null while the message is still a draft |
| `position` | `smallint` | Not null, default 0. Display order within its message |
| `storage_path` | `text` | Not null. `{user_id}/{attachment_id}.{ext}` |
| `thumb_path` | `text` | Nullable. `{user_id}/{attachment_id}_thumb.webp`. Images only; null for PDFs |
| `inline_path` | `text` | Nullable. `{user_id}/{attachment_id}_inline.webp`. Images only; null for PDFs |
| `mime_type` | `text` | Not null. Restricted to the allowlist in `src/lib/constants.ts` |
| `size_bytes` | `integer` | Not null. Capped at `MAX_ATTACHMENT_BYTES` (10 MB) |
| `status` | `text` | Not null, default `'pending'`. One of `pending` \| `ready` \| `failed` |
| `created_at` | `timestamptz` | Default `now()` |

`unique (message_id, position)` where `message_id` is not null, so ordering is
stable and cannot collide.

**Lifecycle rules:**

- At most `MAX_ATTACHMENTS_PER_MESSAGE` (4) attachments may be linked to one message. The limit is enforced server-side when the message is sent, not only in the composer.
- A row is created with `status = 'pending'` and a null `message_id` when the signed upload URL is issued. It flips to `'ready'` once the client confirms the upload completed.
- **An image attachment is three storage objects, not one:** the original, a `_thumb` (80px square, for the 40px composer chip at 2×), and an `_inline` (1440px longest edge, for the message column). Both derivatives are produced **in the browser before upload** and sent through their own signed URLs, so no image is ever transformed on the request path. PDFs have no derivatives and leave both columns null.
- **Every path that deletes an attachment deletes all three objects.** The reaper, the failed-upload cleanup, and the message-delete sweep each remove `storage_path`, `thumb_path`, and `inline_path`. A cleanup that only knows about the original strands two objects per image — manufacturing the exact leak the reaper exists to prevent, at twice the rate.
- Derived objects are validated server-side on the same terms as the original: each signed upload URL is issued against the mime allowlist and `MAX_ATTACHMENT_BYTES`. The client produces the derivatives; it is not trusted to have produced them honestly.
- Sending a message links only `status = 'ready'` rows. A `'pending'` or `'failed'` attachment is dropped from the send and reported to the user rather than silently omitted.
- An upload that fails or is cancelled sets `status = 'failed'`; the client deletes the row and its storage object immediately. If that cleanup call itself fails, the row is left for the reaper rather than retried in a loop.
- **Orphan reaping** runs hourly: `pg_cron` invokes a Supabase Edge Function via `pg_net`, which deletes the storage objects through the Storage API and *then* the rows. It cannot be a plain SQL job — deleting a `storage.objects` row does not delete the file, it strands it in the bucket permanently. A SQL-only reaper would manufacture the exact leak it was written to prevent.
- Deleting a message cascades to its attachment rows. Because that cascade cannot touch storage, the same Edge Function also sweeps objects whose row no longer exists.

### `prompts`

| Column | Type | Notes |
| ------ | ---- | ----- |
| `id` | `uuid` PK | |
| `user_id` | `uuid` | Not null, indexed |
| `title` | `text` | Not null |
| `body` | `text` | Not null |
| `tags` | `text[]` | Default `'{}'`. GIN indexed for filtering |
| `created_at` | `timestamptz` | Default `now()` |
| `updated_at` | `timestamptz` | |

### `shared_key_usage`

| Column | Type | Notes |
| ------ | ---- | ----- |
| `user_id` | `uuid` | Part of the composite primary key |
| `usage_date` | `date` | Part of the composite primary key. UTC calendar day |
| `message_count` | `integer` | Not null, default 0. Compared against the daily limit |
| `input_tokens` | `bigint` | Not null, default 0 |
| `output_tokens` | `bigint` | Not null, default 0 |
| `updated_at` | `timestamptz` | Not null, default `now()`. Touched by every reserve, release, and reconcile. Drives orphan detection |

`primary key (user_id, usage_date)`. Slots are claimed through the conditional
upsert in `reserve_shared_slot`, never through read-then-write.

**Orphaned reservations.** A slot is reserved before the provider call and
released in `onError`. If the process dies in between — a function timeout, an
OOM kill, a deploy mid-request — neither path runs and the slot stays claimed for
a generation the user never received.

This is accepted, bounded, and self-healing rather than prevented:

- **Bounded.** Worst case a user loses a few messages from one day's allowance. The counter resets at 00:00 UTC regardless.
- **Self-healing.** A reconciliation job corrects the drift within ten minutes, using `messages` as the source of truth — an assistant message with `used_shared_key = true` and `status = 'complete'` is proof that a generation was actually delivered.

A process that dies mid-stream leaves two artefacts, and the sweep clears both.
The second is user-visible: an assistant row stuck in `streaming` renders as a
message that loads forever.

```sql
-- 1. Retire assistant rows abandoned mid-stream. Same staleness bound.
update messages
   set status        = 'error',
       error_message = 'Generation was interrupted'
 where status = 'streaming'
   and created_at < now() - interval '5 minutes';
```

```sql
-- 2. Runs every 10 minutes. ONLY EVER LOWERS the counter — it can release a
-- stuck slot but can never charge a user for something the reservation missed.
update shared_key_usage u
   set message_count = sub.actual,
       updated_at    = now()
  from (
    select u2.user_id,
           u2.usage_date,
           (select count(*)
              from messages m
             where m.user_id = u2.user_id
               and m.used_shared_key
               and m.role = 'assistant'
               and m.status = 'complete'
               and (m.created_at at time zone 'utc')::date = u2.usage_date) as actual
      from shared_key_usage u2
     -- Untouched for longer than any request we allow to live. Render's own
     -- ceiling is 100 minutes, so the bound here comes from the application:
     -- STREAM_TIMEOUT_MS (2 min) aborts a hung provider call. 5 minutes is
     -- comfortably past that. A younger row may be a live reservation.
     where u2.updated_at < now() - interval '5 minutes'
  ) sub
 where u.user_id      = sub.user_id
   and u.usage_date   = sub.usage_date
   and u.message_count > sub.actual;
```

The staleness guard is what makes this safe: without it, the sweep would race
live requests and hand out slots that are genuinely in use. It depends on
`updated_at` being touched by **every** quota function — reserve, release, and
token reconciliation. A function that forgets it leaves the column frozen at its
insert value, every row looks stale, and the sweep starts releasing live
reservations. That column is load-bearing, not bookkeeping.

### `shared_key_budget`

| Column | Type | Notes |
| ------ | ---- | ----- |
| `id` | `integer` PK | `check (id = 1)`. A singleton row |
| `period_month` | `date` | The first day of the current accounting month |
| `input_tokens` | `bigint` | Not null, default 0 |
| `output_tokens` | `bigint` | Not null, default 0 |
| `estimated_usd` | `numeric(10,4)` | Not null, default 0. Derived from measured tokens and the Gemini Flash rate card |
| `tripped_at` | `timestamptz` | Nullable. Non-null means the shared key is disabled for everyone |

RLS grants no policy to `authenticated` or `anon` — this table is reachable only
through the service-role client inside `src/server/quota.ts`.

**The ledger records measured tokens only — never estimates.** Every write to
this table comes from a `usage` object the provider actually reported. When a
call fails without reporting usage, nothing is recorded and a warning is logged.

The reasoning is that this ledger is the *input to a circuit breaker*. A
fabricated number does not make it more accurate; it makes the breaker trip on
invented data, cutting off every user for spend that may not have happened. A
small systematic undercount is the acceptable failure mode, and it is why the
ceiling carries headroom.

Because the breaker is therefore best-effort, **the authoritative spend cap is
set at the provider**: a hard budget limit on the Google Cloud billing account
backing `SHARED_GEMINI_API_KEY`. The application-level breaker exists to stop
runaway usage early and give users a clear message; the provider-side cap is what
actually guarantees the bill. Configuring it is a step in feature 38, not
optional hardening.

### Row-Level Security

Every table above has `enable row level security`. **`shared_key_budget` is the
one deliberate exception to the policy shape**: RLS is enabled on it, but no
policy is defined for any role, which makes it unreachable through the anon key
by construction. It is a global operational counter with no owner, so there is no
`auth.uid()` to scope it to. Only the service-role client in `src/server/quota.ts`
can read or write it.

Every other table follows a uniform owner shape:

```sql
create policy "owner reads"   on messages for select using (auth.uid() = user_id);
create policy "owner writes"  on messages for insert with check (auth.uid() = user_id);
create policy "owner updates" on messages for update using (auth.uid() = user_id);
create policy "owner deletes" on messages for delete using (auth.uid() = user_id);
```

Public sharing is expressed as two additional read policies for the `anon` role,
so that share links stay inside RLS rather than bypassing it with a service-role
client:

```sql
create policy "anon reads shared conversations" on conversations
  for select to anon using (share_slug is not null);

create policy "anon reads shared messages" on messages
  for select to anon using (
    exists (
      select 1 from conversations c
      where c.id = messages.conversation_id
        and c.share_slug is not null
    )
  );
```

`provider_keys` has no `anon` policy of any kind, and no policy grants `select`
on `ciphertext` to anyone but the owning user.

---

## File / Object Storage

| Bucket / Location | Path | Contents | Access |
| ----------------- | ---- | -------- | ------ |
| `attachments` | `{user_id}/{attachment_id}.{ext}` | User-uploaded images (PNG, JPEG, WebP, GIF) and PDFs, capped at 10 MB each | Private. A storage RLS policy restricts every operation to objects whose first path segment equals `auth.uid()`. Reads are served through short-lived signed URLs generated server-side; the bucket is never made public |

Attachments on a shared conversation are **not** exposed through the share link —
the public view renders a placeholder in their place. Opening that up would mean
signing URLs for anonymous visitors, which is out of scope.

---

## Authentication

- Provider: Supabase Auth
- Methods: Google OAuth only. No email/password, no magic links, no other providers.
- Protected: `/chat`, `/chat/[id]`, `/compare`, `/prompts`, `/search`, `/settings/*`, and every route under `/api/*` **except `/api/health`**.
- Public: `/` (landing), `/auth/callback`, `/share/[slug]`, `/api/health`.
- `/api/health` exists solely so Render can probe liveness. It returns `{ ok: true }` and nothing else — no session lookup, no database query, no version string, no environment detail. A health check that touches the database turns a slow query into a restart loop, and one that leaks build metadata is free reconnaissance.
- The session is cookie-based and refreshed in `src/proxy.ts` on every matching request, which is what keeps Server Components from rendering a stale signed-out state. (Next.js 16 renamed `middleware.ts` → `proxy.ts`; the Supabase cookie logic is unchanged.)
- Route protection is enforced in two places, deliberately: `src/app/(app)/layout.tsx` calls `requireUser()` and redirects to `/`, and every route handler calls `requireUser()` independently. The proxy refreshes the session but is never the authorisation check.
- `requireUser()` uses `supabase.auth.getUser()`, which validates the JWT against the auth server. `getSession()` reads unverified cookie data and must never be used for an authorisation decision.
- Post-login destination: `/chat`.

---

## Key Patterns

### Supabase server client (Server Components and route handlers)

```typescript
// src/server/supabase.ts
import 'server-only'

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'

/** Cookie-bound client. RLS applies — this is the default for all user data. */
export async function createServerSupabaseClient() {
  const cookieStore = await cookies()

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options)
            }
          } catch {
            // Called from a Server Component, where cookies are read-only.
            // Middleware refreshes the session, so this is safe to swallow.
          }
        },
      },
    },
  )
}

/**
 * Bypasses RLS. Permitted ONLY in src/server/quota.ts for shared_key_budget.
 * Every other use is a bug.
 */
export function createServiceRoleClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
}
```

### Supabase browser client

```typescript
// src/lib/supabase-browser.ts
import { createBrowserClient } from '@supabase/ssr'

import type { Database } from '@/types/database'

export function createBrowserSupabaseClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  )
}
```

### Session refresh proxy

Next.js 16 renamed `middleware.ts` to `proxy.ts` and the export from `middleware`
to `proxy`. The runtime is always `nodejs` and cannot be configured. Every
Supabase SSR snippet you will find online still says "middleware" — the cookie
logic is unchanged, only the file and function names moved.

```typescript
// src/proxy.ts
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function proxy(request: NextRequest) {
  const response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet, headers) {
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options)
          }
          for (const [key, value] of Object.entries(headers)) {
            response.headers.set(key, value)
          }
        },
      },
    },
  )

  // Refreshes the token and writes the rotated cookies onto the response.
  // Do not remove: without it, Server Components can render a stale session.
  await supabase.auth.getUser()

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|webp)$).*)'],
}
```

### Session guard

```typescript
// src/server/auth.ts
import 'server-only'

import { redirect } from 'next/navigation'
import type { User } from '@supabase/supabase-js'

import { createServerSupabaseClient } from './supabase'

/** Throws in route handlers, redirects in Server Components. */
export async function requireUser(): Promise<User> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.auth.getUser()

  if (error || !data.user) redirect('/')
  return data.user
}

/** Route-handler variant: returns null instead of redirecting. */
export async function getUser(): Promise<User | null> {
  const supabase = await createServerSupabaseClient()
  const { data } = await supabase.auth.getUser()
  return data.user ?? null
}
```

### The encryption vault

```typescript
// src/server/vault.ts
import 'server-only'

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12
const KEY_BYTES = 32

function masterKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY
  if (!raw) throw new Error('ENCRYPTION_KEY is not set')

  const key = Buffer.from(raw, 'base64')
  if (key.length !== KEY_BYTES) {
    throw new Error(`ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes, got ${key.length}`)
  }
  return key
}

export type SealedSecret = {
  ciphertext: Buffer
  iv: Buffer
  authTag: Buffer
}

export function encrypt(plaintext: string): SealedSecret {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, masterKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])

  return { ciphertext, iv, authTag: cipher.getAuthTag() }
}

export function decrypt({ ciphertext, iv, authTag }: SealedSecret): string {
  const decipher = createDecipheriv(ALGORITHM, masterKey(), iv)
  decipher.setAuthTag(authTag)

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}

/** The only representation of a key that may leave the server. */
export function lastFour(apiKey: string): string {
  return apiKey.slice(-4)
}
```

### Provider resolution

Every chat request goes through this function. It is the single place that
decides which key answers a request and whether the shared quota applies.

```typescript
// src/server/providers.ts
import 'server-only'

import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogle } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import type { LanguageModel } from 'ai'

import { SHARED_MODEL_ID } from '@/lib/constants'
import type { Provider } from '@/types/domain'
import { serverEnv } from './env'
import { getDecryptedKey } from './keys'
import { reserveSharedSlot } from './quota'

export type ResolvedModel = {
  model: LanguageModel
  usedSharedKey: boolean
}

export async function resolveModel(
  userId: string,
  provider: Provider,
  modelId: string,
): Promise<ResolvedModel> {
  const apiKey = await getDecryptedKey(userId, provider)

  if (apiKey) {
    return { model: instantiate(provider, modelId, apiKey), usedSharedKey: false }
  }

  // No personal key: the shared Gemini key is the only fallback.
  if (provider !== 'google' || modelId !== SHARED_MODEL_ID) {
    throw new MissingKeyError(provider)
  }

  // Atomically claims one slot. Throws QuotaExceededError (429) if the daily
  // allowance is spent, or BudgetExhaustedError (503) if the breaker is tripped.
  // Claiming — not checking — is what makes concurrent requests safe.
  await reserveSharedSlot(userId)

  return {
    model: instantiate('google', SHARED_MODEL_ID, serverEnv.SHARED_GEMINI_API_KEY),
    usedSharedKey: true,
  }
}

function instantiate(provider: Provider, modelId: string, apiKey: string): LanguageModel {
  switch (provider) {
    case 'openai':
      return createOpenAI({ apiKey })(modelId)
    case 'anthropic':
      return createAnthropic({ apiKey })(modelId)
    case 'google':
      // v7 renamed the Google factory: createGoogleGenerativeAI → createGoogle.
      return createGoogle({ apiKey })(modelId)
    case 'openrouter':
      return createOpenRouter({ apiKey })(modelId)
  }
}

export class MissingKeyError extends Error {
  constructor(readonly provider: Provider) {
    super(`No API key configured for ${provider}`)
    this.name = 'MissingKeyError'
  }
}
```

### Streaming chat route handler

```typescript
// src/app/api/chat/route.ts
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  streamText,
  toUIMessageStream,
} from 'ai'

import { chatRequestSchema } from '@/lib/schemas'
import { getUser } from '@/server/auth'
import { getConversation } from '@/server/data/conversations'
import {
  appendMessage,
  completeMessage,
  failMessage,
  listByConversation,
} from '@/server/data/messages'
import { resolveModel } from '@/server/providers'
import { recordSharedKeyTokens, releaseSharedSlot } from '@/server/quota'
import { STREAM_TIMEOUT_MS } from '@/lib/constants'
import { textOf } from '@/lib/utils'

// Documents intent; on Render every route is Node already, so nothing can
// silently switch this to Edge and break node:crypto in the vault.
export const runtime = 'nodejs'

export async function POST(request: Request) {
  const user = await getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = chatRequestSchema.safeParse(await request.json())
  if (!parsed.success) {
    return Response.json({ error: 'Invalid request', code: 'invalid_input' }, { status: 400 })
  }

  // Note: `message` is singular. The client sends only the newest turn.
  const { conversationId, message, provider, modelId } = parsed.data

  const conversation = await getConversation(conversationId)
  if (!conversation) return Response.json({ error: 'Not found' }, { status: 404 })

  const history = await listByConversation(conversationId)

  // Resolve and reserve BEFORE writing anything. Claims a shared-key slot
  // atomically when no personal key exists, and throws MissingKeyError (400),
  // QuotaExceededError (429), or BudgetExhaustedError (503). A refusal here
  // must leave no dangling prompt in the thread.
  const { model, usedSharedKey } = await resolveModel(user.id, provider, modelId)

  // Past this point the request will reach a provider, so persistence is safe.
  await appendMessage({
    conversationId,
    userId: user.id,
    role: 'user',
    content: textOf(message),
  })

  // The assistant row is created up front in 'streaming' status. Holding its id
  // is what makes the failure path unambiguous — at onError the newest message
  // is the USER's, so "mark the last message errored" would mark the prompt.
  const assistantMessageId = await appendMessage({
    conversationId,
    userId: user.id,
    role: 'assistant',
    content: '',
    status: 'streaming',
    provider,
    modelId,
    usedSharedKey,
  })

  const result = streamText({
    model,
    system: conversation.system_prompt ?? undefined,
    messages: await convertToModelMessages(history),
    abortSignal: AbortSignal.timeout(STREAM_TIMEOUT_MS),
    onFinish: async ({ text, usage }) => {
      await completeMessage(assistantMessageId, {
        content: text,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      })

      // The slot was already claimed; this only reconciles token totals.
      if (usedSharedKey) await recordSharedKeyTokens(user.id, usage)
    },
    onError: async ({ error }) => {
      console.error('[api/chat] stream failed', error)
      // Keeps whatever partial content arrived, rather than dropping it.
      await failMessage(assistantMessageId, { error })
      // Refund the reserved slot — a failed generation must not cost the user.
      if (usedSharedKey) await releaseSharedSlot(user.id)
    },
  })

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({ stream: result.stream }),
  })
}
```

### Design tokens in Tailwind v4

Tokens come from `DESIGN.md` and are declared once, in CSS. Components reference
the semantic name, never a hex value.

```css
/* src/app/globals.css */
@import "tailwindcss";

@theme {
  /* Surfaces — warm dark. Never pure black; the warmth is the brand. */
  --color-canvas: #2b2622;
  --color-canvas-soft: #383330;
  --color-hairline: #3f3a36;

  /* Text */
  --color-ink: #f7f5f0;
  --color-body-strong: #dad2c1;
  --color-body: #c9c0ad;
  --color-mute: #aea69c;

  /* The only "brand colour" is the off-white. There is no chromatic accent. */
  --color-primary: #f7f5f0;
  --color-on-primary: #2b2622;

  /* State-only extensions — see code-standards.md. Never used decoratively. */
  --color-danger: #d8735e;
  --color-warn: #d6a962;
  --color-success: #8fae7e;

  --font-sans: Inter, system-ui, -apple-system, sans-serif;
  --font-mono: "DM Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  --font-serif: "Instrument Serif", Georgia, "Times New Roman", serif;

  /* The DESIGN.md type scale, one utility per step. A font-size token carries
     its line-height, tracking and weight via `--` modifiers, so `text-display-md`
     sets all four properties at once. Family is NOT carried — see the note below. */
  --text-display-xl: 64px;
  --text-display-xl--line-height: 70.4px;
  --text-display-xl--letter-spacing: -1.6px;
  --text-display-xl--font-weight: 400;

  --text-display-lg: 48px;
  --text-display-lg--line-height: 52.8px;
  --text-display-lg--letter-spacing: -1.2px;
  --text-display-lg--font-weight: 400;

  --text-display-md: 32px;
  --text-display-md--line-height: 40px;
  --text-display-md--letter-spacing: -0.8px;
  --text-display-md--font-weight: 500;

  --text-display-sm: 24px;
  --text-display-sm--line-height: 32px;
  --text-display-sm--letter-spacing: -0.4px;
  --text-display-sm--font-weight: 500;

  /* Pair with `font-serif`. */
  --text-display-serif: 48px;
  --text-display-serif--line-height: 52px;
  --text-display-serif--letter-spacing: -0.5px;
  --text-display-serif--font-weight: 400;

  --text-body-lg: 18px;
  --text-body-lg--line-height: 28px;
  --text-body-lg--font-weight: 400;

  --text-body-md: 16px;
  --text-body-md--line-height: 24px;
  --text-body-md--font-weight: 400;

  --text-body-md-strong: 16px;
  --text-body-md-strong--line-height: 24px;
  --text-body-md-strong--font-weight: 500;

  --text-body-sm: 14px;
  --text-body-sm--line-height: 20px;
  --text-body-sm--font-weight: 400;

  --text-body-sm-strong: 14px;
  --text-body-sm-strong--line-height: 20px;
  --text-body-sm-strong--font-weight: 500;

  --text-caption: 12px;
  --text-caption--line-height: 16px;
  --text-caption--font-weight: 400;

  /* Pair with `font-mono`. */
  --text-code: 13px;
  --text-code--line-height: 18px;
  --text-code--font-weight: 400;

  /* Pair with `font-mono`. */
  --text-code-md: 14px;
  --text-code-md--line-height: 20px;
  --text-code-md--font-weight: 400;

  --text-button-md: 14px;
  --text-button-md--line-height: 20px;
  --text-button-md--font-weight: 500;

  --radius-sm: 3px;   /* default button radius — deliberately tight */
  --radius-md: 4px;   /* card chrome */
  --radius-lg: 6px;
  --radius-pill: 9999px;

  --spacing-xxs: 2px;
  --spacing-xs: 4px;
  --spacing-sm: 8px;
  --spacing-md: 10px;
  --spacing-lg: 16px;
  --spacing-xl: 24px;
  --spacing-2xl: 32px;
  --spacing-3xl: 48px;
  --spacing-4xl: 64px;
  --spacing-5xl: 96px;

  /* The design system has exactly two boundaries. Clearing the namespace first
     deletes Tailwind's sm/md/lg/xl/2xl, so `sm:flex-row` fails to compile
     rather than silently introducing a third breakpoint nobody designed.
     rem, not px — Tailwind sorts breakpoints by unit and mixing them
     misorders the generated utilities. */
  --breakpoint-*: initial;
  --breakpoint-tablet: 48rem;   /* 768px */
  --breakpoint-desktop: 64rem;  /* 1024px */
}
```

**A font-size token does not carry its family.** Tailwind's `--text-*` modifiers
cover line-height, letter-spacing and weight only, so the three steps whose
family is not Inter need the family utility alongside them:

```html
<h1 class="font-serif text-display-serif">…</h1>
<code class="font-mono text-code">gemini-2.5-flash</code>
```

Every other step is Inter, which is `--font-sans` and therefore inherited from
`body`. Nothing else needs a family class.

**Layout is mobile-first and has two prefixes.** Unprefixed styles are the
mobile case; `tablet:` applies from 768px and `desktop:` from 1024px. There is
no third prefix, by construction.

```html
<!-- drawer on mobile, overlay from 768px, persistent column from 1024px -->
<aside class="fixed inset-y-0 tablet:absolute desktop:static desktop:w-[260px]">
```

Width is not the same axis as input. An iPad in landscape is 1024px wide and
therefore `desktop:`, but it has no hover — so the breakpoint prefixes decide
*layout* and `pointer: coarse` decides *affordances*. Never use a width query to
infer that a pointer is fine.

---

## Invariants

**Secrets**

- No HTTP response body, no server log, no error message, and no client-visible payload may ever contain a decrypted provider API key. The only key material permitted to leave the server is `last_four`.
- A decrypted API key exists only as a local variable inside a single request in `src/server/`. It is never assigned to a module-level variable, cached, stored in React state, or written to the database.
- `src/server/vault.ts` is the only module that imports `node:crypto` for encryption, and the only module that reads `ENCRYPTION_KEY`.
- Every encryption generates a fresh random 12-byte IV. An IV is never reused across two encryptions.
- Every secret environment variable is read through `src/server/env.ts` and nowhere else. `src/lib/` holds public configuration only and must never reference `ENCRYPTION_KEY`, `SUPABASE_SECRET_KEY`, or `SHARED_GEMINI_API_KEY`.
- `SHARED_GEMINI_API_KEY` is consumed only inside `src/server/providers.ts`.

**Data isolation**

- Every table holding user data has RLS enabled with a policy scoped to `auth.uid()`. Enabling RLS is part of the same migration that creates the table, never a later one.
- Application code is never the only thing enforcing ownership. A query that returns another user's row must be impossible at the database level even if the application forgets its `where` clause.
- `createServiceRoleClient()` may be called only from `src/server/quota.ts`. Any other call site is a bug.
- `supabase.auth.getUser()` is the only accepted basis for an authorisation decision. `getSession()` must never gate access to data.
- `/share/[slug]` reads through the `anon` RLS policies. It must never use a service-role client to work around them.

**Boundaries**

- Every file in `src/server/` begins with `import 'server-only'`.
- No file under `src/components/` imports anything from `src/server/`.
- No file under `src/lib/` imports from `src/server/` or reads a secret environment variable.
- Supabase queries (`.from(…)`) are written only in `src/server/data/`. Route handlers and Server Components call those functions; they do not query directly.
- Route handlers contain no business logic — they validate input, delegate to `src/server/`, and shape the response.

**Chat correctness**

- `messages` is a flat, ordered list. No column expressing a parent, branch, or variant may be added to it.
- Every chat request resolves its model through `resolveModel()`. No route may construct a provider client directly.
- The client sends only the newest message. History is loaded server-side from the database and is never taken from the request body — a client must not be able to rewrite its own past turns.
- Nothing is persisted until the request is certain to reach a provider. Resolution and quota reservation come first; a `400`, `429`, or `503` leaves no row behind, so a refusal can never produce a prompt with no answer.
- Once resolution succeeds, the user message and an assistant row with `status = 'streaming'` are both written before the provider call. The assistant row's id is held for the life of the stream, and completion and failure are targeted updates by primary key — never "update the most recent message", which at failure time would target the user's prompt.
- A stream that fails or aborts keeps whatever partial content arrived and sets `status = 'error'`. Rows are never deleted on failure.
- Every assistant message records the `provider` and `model_id` that actually produced it, so a conversation whose model changed mid-thread stays accurate.
- Editing a user message deletes every message created after it in that conversation before regenerating.
- The compare view persists nothing. A conversation exists only after the user promotes one side of the comparison.

**Quota**

- The daily allowance is **claimed, never checked**. A single conditional upsert increments the counter and returns a row only if the limit had not yet been reached. Reading the count and incrementing it later — in any form, including inside one transaction that reads first — is forbidden: it lets concurrent requests both pass at the boundary.
- A slot is reserved *before* the provider is called and released if the generation fails or is aborted. A user is never charged for a response they did not receive.
- Token totals are reconciled after completion; they are accounting, not enforcement, and must never be the thing a limit is tested against.
- The shared key is refused when either the global circuit breaker is tripped or the per-user daily slot cannot be claimed. Both checks are mandatory, and the breaker is evaluated first — a tripped breaker must not consume a user's daily slot.
- Quota limits are read from `src/lib/constants.ts`. No numeric limit is written inline at a call site.
- Users with their own key are never quota-checked. Their requests must succeed even when the global breaker is tripped.
- Title generation runs on the shared key but does **not** claim a user slot. It is system overhead, not a user message. Its tokens are still reconciled into `shared_key_budget`, because they cost real money.
- `shared_key_budget` records measured token usage only. When a provider call fails without reporting usage, nothing is written and a warning is logged — an estimate must never enter a ledger that drives a circuit breaker.
- The reconciliation sweep may only lower `message_count`, and only on rows untouched for longer than the maximum request duration. A job that can raise the counter, or that ignores the staleness guard, would charge users for in-flight requests.
- Every provider call is bounded by `STREAM_TIMEOUT_MS` via an `AbortSignal`. Render permits a 100-minute request, so nothing in the platform will stop a hung provider connection — the application must, or a stuck stream holds a reservation and a process slot indefinitely.
- `/share/[slug]` is never cached: `force-dynamic`, `no-store`, and excluded from `cacheComponents`. Revocation must be immediate.

**Design**

- `DESIGN.md` is the source of truth for every visual value. Colours, spacing, radii, and type scales come from the `@theme` tokens; no raw hex value or arbitrary pixel size appears in a component.
- The interface is dark-only. No light-mode variant, no `prefers-color-scheme` branch, no theme toggle.
- No chromatic brand accent is introduced. `--color-danger`, `--color-warn`, and `--color-success` are reserved exclusively for state feedback and are never used for emphasis, decoration, or a call to action.
- Elevation is expressed with surface contrast and 1px hairline borders. No `box-shadow` on cards.
- Button radius stays at `--radius-sm` (3px) or `--radius-md` (4px). Pill-shaped buttons are only for icon containers and status chips.
- No control or information is reachable only on hover. Anything revealed by `:hover` on a fine pointer is persistently visible under `@media (pointer: coarse)`. A touch device must never lose access to a function.
- Only `tablet:` and `desktop:` responsive prefixes exist. Unprefixed styles are the mobile case; a width query is never used to decide whether hover is available.

**General**

- Every route handler input is parsed with a zod schema before use.
- Secrets are read from `process.env` inside `src/server/` only, never inlined, and never prefixed `NEXT_PUBLIC_`.
- Schema changes are made by adding a migration under `supabase/migrations/`, never through the dashboard.
- No image is transformed on the request path. Every `next/image` carries `unoptimized`; sizes are produced once, in the browser, at upload time. The Node process runs one instance and it is busy streaming.
- Any code path that deletes an attachment deletes all three of its storage objects — `storage_path`, `thumb_path`, `inline_path` — through the Storage API.
