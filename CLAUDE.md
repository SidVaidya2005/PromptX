# PromptX

An AI chat workspace with Google Sign-In where users chat with OpenAI, Anthropic,
Google, and OpenRouter models using their own encrypted API keys — or a shared
Gemini key capped at 5 messages a day.

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
- **For libraries**, follow the authority order: **Context7** (`resolve-library-id` → `query-docs`) → skills and MCP servers (below) → `context/library-docs.md` → official docs via web search. Never write an API shape from training-data memory — if none of those answers it, ask.
- **Stay in scope.** Build only what the current feature in `build-plan.md` requires.
- **Use logical commits.** Keep each commit focused, easy to review, and in a working state whenever possible.
- **Number every commit subject `<phase>.<feature>.<n> - Capitalized summary`** — `3.18.1 - Derive the outline rail from the loaded thread`. `<phase>` and `<feature>` are the current phase and feature numbers from `build-plan.md`, feature zero-padded to two digits; `<n>` is not padded. The separator is a space-hyphen-space. Read `<phase>` off `build-plan.md` rather than carrying it forward: features 12 and 13 opened Phase 2 but were committed as `1.12.x` / `1.13.x`, because the phase digit was inherited from feature 11 instead of looked up.
- **`<n>` restarts at 1 for every feature.** It counts commits *within* a feature, never across the project: feature 18's first commit is `3.18.1`, its second `3.18.2`, and feature 19 opens again at `3.19.1`. To find the next one, read back through `git log --format=%s` for the highest `<n>` already used **by the current feature** and add one — not `git log -1` alone, which usually sits on the previous feature and would restart the count in the wrong place.
- **This project does not use feature `00`.** Work that belongs to no numbered feature — a phase checkpoint, a chore, a fix between features — carries the phase's most recently completed feature number, as the Phase 2 checkpoint did at `2.17.10`. A deliberate deviation from the `setup-context` template, kept because the existing history already reads that way.
- **Ask before committing.** Never create a commit without explicit user approval, and never add coauthors unless the user explicitly requests them.
- **Checkpoint every phase.** Before moving to the next phase, run the relevant verification commands, inspect the phase diff, check for obvious bugs/regressions, confirm code consistency, update `progress-tracker.md`, compact `build-journal.md` (see below), and record any follow-up work.
- **Update `progress-tracker.md`** after every completed feature — tick the box, **overwrite** Current Status (never append to it; it holds only the latest state), and add the single most important decision to the top of "Key Decisions". That section holds the 10 most recent decisions, newest first — when adding an 11th, file the oldest under its topic in `context/constraints.md`.
- **Read `context/constraints.md`** before any decision that might conflict with past work. It is grouped by topic and holds only what still binds, so it stays short and cheap to read.
- **Append to `context/build-journal.md`** after each completed feature — a dated entry with the decisions made, gotchas hit, and verification results. **Never read this file at session start**; it grows for the life of the project. Open it only to reconstruct one specific feature's history.
- **Compact `build-journal.md` at phase checkpoints**, never continuously: promote that phase's still-binding decisions into `constraints.md` under their topic, collapse its per-feature entries into a few summary bullets, and drop the `Verified:` lines. Never remove a constraint that still binds. `git` history holds anything removed, so compact confidently.

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

Working today (feature 01 shipped the scaffold that provides them):

- `pnpm install` — install dependencies
- `pnpm dev` — development server on http://localhost:3000 (Turbopack is default in Next 16; no `--turbopack` flag)
- `pnpm build` — production build
- `pnpm start` — serve the production build (this is what Render runs; `next start` binds `PORT`)
- `pnpm lint` — ESLint CLI with flat config (`next lint` was removed in v16)
- `pnpm typecheck` — `tsc --noEmit`
- `pnpm test` — Vitest unit tests. Skips the hosted suites with a banner when `.env.local` is absent; **refuses to run** when it is present but incomplete
- `pnpm test:coverage` — the same suite with a v8 coverage report over `src/server/`. No threshold: it is a discovery instrument, not a gate
- `pnpm test:e2e` — Playwright end-to-end tests (feature 36). Runs against a **production build**, so a cold run pays one `next build`. Needs `.env.local` and `pnpm exec playwright install chromium`, and **fails with a message naming what is missing** rather than skipping — every spec is hosted, so a skipping run would prove nothing

Not available in this project:

- `supabase start` — start the local Supabase stack
- `supabase db reset` — reapply every migration and reseed
- `supabase gen types typescript --local > src/types/database.ts` — regenerate database types after a migration

  **These three do not apply to this project as set up.** Feature 02 chose a
  hosted-only workflow: there is no local stack, and the CLI is not installed.
  Migrations live in `supabase/migrations/` as the source of truth but are
  applied through the **Supabase MCP** (`apply_migration`), and types come from
  MCP `generate_typescript_types`. The commands are kept here because they are
  what the wider ecosystem assumes — reach for the MCP instead.

  One consequence to keep in view: without `supabase db reset`, **no migration
  is ever proven to replay from an empty database.** Adding the local stack
  later is the fix; until then, treat replayability as untested.

## Skills and MCP servers available

- **Context7 MCP** (`resolve-library-id` → `query-docs`) — current documentation for any library. Use it before writing against an unfamiliar API.
- **Supabase MCP** — read the live schema, apply migrations, run security advisors, generate types. Prefer it over hand-writing SQL blind.
- **`supabase` skill** — Supabase development and security guidance.
- **`supabase-postgres-best-practices` skill** — read before writing indexes, RLS policies, or anything performance-sensitive in Postgres.
- **`playwright-cli` skill** — drive a real browser to see a change working: `open`, `goto`, `snapshot`, `click`, `resize`, `--device` emulation. This replaced the Playwright MCP server, which is gone. Reach for it whenever a feature can only be confirmed by looking at it — a UI feature verified only by `pnpm test` is not verified, because `vitest.config.ts` matches `tests/**/*.test.ts` in a node environment and can see nothing rendered.

  Two things to know before using it here. Sign-in is Google OAuth only, so an unauthenticated browser gets bounced to `/` — open with `--persistent --profile` against a signed-in profile, or `state-load` a saved session. And this is a **debugging tool, not a project dependency**: `@playwright/test`, `playwright.config.ts`, and `e2e/` all still arrive at feature 36, and using the CLI now must not add any of them.
