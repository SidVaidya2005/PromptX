# PromptX

An AI chat workspace with Google Sign-In where users chat with OpenAI, Anthropic,
Google, and OpenRouter models using their own encrypted API keys — or a shared
Gemini key capped at 20 messages a day.

## Project context lives in `context/`

The `context/` folder is the source of truth for this project. **Read it before
writing any code**, and keep it current as you work. Read in this order:

1. **`context/project-overview.md`** — what the product is, who it's for, what's in and out of scope.
2. **`context/architecture.md`** — stack, folder structure, system boundaries, data model, and the **invariants you must never violate**.
3. **`context/code-standards.md`** — the rules every change must follow.
4. **`context/library-docs.md`** — project-specific usage patterns for each library (read the relevant section before using one).
5. **`context/build-plan.md`** — the ordered phases and features to build.
6. **`context/progress-tracker.md`** — what's done, in progress, and next.

**`context/DESIGN.md`** is the design system — the source of truth for every
colour, type scale, radius, and spacing value. Read it before building any UI,
and never invent a visual value that is not in it.

## Standing rules

- **Read `context/` first.** Never assume — verify against `project-overview.md` and `architecture.md`.
- **Obey the invariants** in `architecture.md`. They are non-negotiable.
- **Follow `code-standards.md`** on every change.
- **For libraries**, follow the authority order: **Context7** (`resolve-library-id` → `query-docs`) → skills and MCP servers (below) → `context/library-docs.md` → general knowledge. If Context7 has no match, use web search for official docs — never rely on training-data memory for API shapes.
- **Stay in scope.** Build only what the current feature in `build-plan.md` requires.
- **Update `progress-tracker.md`** after every completed feature — check the box, set current status, and add the single most important decision to "Key Decisions" (cap ~10 bullets).
- **Archive detail in `build-journal.md`** — after each feature, append a dated entry with full decisions, gotchas, and verification results. Prune `progress-tracker.md` "Key Decisions" into here when it exceeds ~10 bullets. Consult it when revisiting a completed feature, investigating a regression, or making a decision that might conflict with past work.

### Deployment target

PromptX runs on **Render** as a single long-lived Node Web Service, with Supabase
providing the database, auth, storage, and scheduled jobs. It is **not**
serverless — most Next.js deployment advice you will find assumes Vercel and is
wrong here in specific ways:

- `export const maxDuration` does nothing. Render allows a 100-minute request, so streams are bounded by `STREAM_TIMEOUT_MS` in application code instead.
- There is no Edge runtime to worry about; every route is Node.
- The process is long-lived, so in-memory caches actually persist.
- Scheduled work runs in `pg_cron` inside Supabase, not as a platform cron.

See "Hosting model" in `context/architecture.md` before touching anything
deployment-shaped.

### The three rules that matter most here

This codebase holds other people's API keys and other people's conversations.
Before any change that touches secrets, data access, or spending:

- **No decrypted API key ever leaves the server.** Not in a response body, not in a log, not in an error message. `last_four` is the only key material the client may receive.
- **RLS is the isolation boundary, not application code.** Every table has a policy scoped to `auth.uid()`. A missing `where` clause must not be able to leak a row.
- **The shared key is quota-enforced on two independent axes** — a per-user daily cap and a global monthly circuit breaker. Both checks are mandatory; neither substitutes for the other.

## Commands

> **Nothing below exists yet.** This repository currently contains documentation
> only — no `package.json`, no `src/`, no `supabase/`. These are the commands
> feature 01 and 02 will create. Do not run them expecting them to work; the
> first task in `build-plan.md` is to scaffold the project that provides them.

- `pnpm install` — install dependencies
- `pnpm dev` — development server on http://localhost:3000 (Turbopack is default in Next 16; no `--turbopack` flag)
- `pnpm build` — production build
- `pnpm start` — serve the production build (this is what Render runs; `next start` binds `PORT`)
- `pnpm lint` — ESLint CLI with flat config (`next lint` was removed in v16)
- `pnpm typecheck` — `tsc --noEmit`
- `pnpm test` — Vitest unit tests
- `pnpm test:e2e` — Playwright end-to-end tests
- `supabase start` — start the local Supabase stack
- `supabase db reset` — reapply every migration and reseed
- `supabase gen types typescript --local > src/types/database.ts` — regenerate database types after a migration

## Skills and MCP servers available

- **Context7 MCP** (`resolve-library-id` → `query-docs`) — current documentation for any library. Use it before writing against an unfamiliar API.
- **Supabase MCP** — read the live schema, apply migrations, run security advisors, generate types. Prefer it over hand-writing SQL blind.
- **`supabase` skill** — Supabase development and security guidance.
- **`supabase-postgres-best-practices` skill** — read before writing indexes, RLS policies, or anything performance-sensitive in Postgres.
- **Playwright MCP** — drive a running browser when debugging the app interactively.
