# Build Plan

> **Role:** The ordered plan — phases and numbered features to build, in sequence.
> **Read before starting a feature**; build one feature fully before the next.
> **Relates to:** features come from `project-overview.md`; status tracked in `progress-tracker.md`.

## Core Principle

**Build the thinnest working slice first, then deepen it — and never let the
database be the last thing to get right.**

Every feature is built UI-first against real data as soon as real data exists.
Phase 0 lands the schema and its Row-Level Security policies before a single
screen is built, because retrofitting isolation onto a working app is where
security bugs come from. From Phase 1 onward, each feature must be demonstrable
in the browser the moment it is finished: if it cannot be clicked and seen
working, it is not done.

The ordering has one further rule. **The shared Gemini key comes before
bring-your-own keys** (Phase 1 before Phase 2), so that a complete streaming
chat experience exists on a single hardcoded path before the multi-provider
resolution logic is introduced. That way, when a provider bug appears in Phase 2,
it is unambiguously a provider bug.

---

## Phase 0 — Foundation

### 01 Project scaffold and design tokens

Stand up the Next.js application with the full toolchain and the `DESIGN.md`
token system in place, so no feature is ever built against placeholder styling.

**UI:**

- A single page rendering on the warm dark canvas with Inter, DM Mono, and Instrument Serif loading correctly
- A token proof page (removed at the end of Phase 0) showing every colour, type scale, radius, and spacing step from `DESIGN.md` for visual confirmation

**Logic:**

- `create-next-app` with TypeScript, App Router, Tailwind v4 (Next 16 — Turbopack is default, so no `--turbopack` flags in `package.json`)
- `tsconfig.json` with `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, and the `@/` path alias
- The full `@theme` token block in `src/app/globals.css`, transcribed from `DESIGN.md`
- Fonts wired through `next/font/google` in the root layout
- shadcn/ui initialised and its `button`, `input`, `dialog`, `dropdown-menu`, and `tooltip` primitives restyled to the tokens
- Prettier with `prettier-plugin-tailwindcss`; ESLint via the CLI with flat config (`eslint.config.mjs`) and the import-order rule — `next lint` no longer exists in v16
- **The boundary invariants enforced as lint rules, not just prose.** `eslint-plugin-import` is already present for import-order, so this is one more rule from a plugin already loaded — it costs nothing at `dev` or `build` time, since linting is a separate `pnpm lint` step in v16. Set up here, while the tree is empty; retrofitting it after 38 features means clearing a backlog of violations first:

  ```js
  // eslint.config.mjs
  'import/no-restricted-paths': ['error', {
    zones: [
      { target: './src/components', from: './src/server' },
      { target: './src/lib',        from: './src/server' },
    ],
  }]
  ```

  `target` is where the restriction applies, `from` is what may not be imported. This complements `server-only` rather than duplicating it: `server-only` fails the **build** when a server module reaches a client bundle, while the lint rule flags the **import statement** as you type, and covers `src/lib/` → `src/server/`, which never reaches a bundle boundary to trip `server-only` in the first place
- The "queries live only in `src/server/data/`" invariant enforced with `no-restricted-syntax` matching `CallExpression[callee.property.name='from']`, in a flat-config block scoped to `src/**` with `src/server/data/**` ignored. **This one needs care:** `Array.from()` and `Buffer.from()` match the same selector and both appear in legitimate code — the vault reads `Buffer.from(raw, 'base64')`. Exclude them in the selector and verify the rule is quiet against real code before committing to it. If it still proves noisy, drop it and restrict *imports of the Supabase client factory* to `src/server/data/**` instead, which is the same guarantee expressed as an import zone
- `.env.example` covering every variable in `code-standards.md`
- `src/server/env.ts` validating the **secret** environment with zod at boot, carrying `import 'server-only'`
- `src/lib/constants.ts` holding public limits only — no secret is readable from `src/lib/`
- Vitest configured here rather than at feature 03, since `pnpm test` is listed in `CLAUDE.md` as a feature 01–02 command and the feature 03 RLS suite depends on it existing. Playwright is deferred to feature 36, where the first spec is actually written

**Decisions taken during this feature** (see `build-journal.md` for the full entries):

- **shadcn is retuned, not aliased.** `globals.css` carries only the PromptX `@theme`; the CLI's `:root`/`.dark`/`@theme inline` layer is deleted wholesale and each primitive is hand-edited. A future `shadcn add` therefore produces something visibly wrong until retuned, which is the intended forcing function
- **The two quota env vars are renamed `NEXT_PUBLIC_*`**, because Next inlines only that prefix into client bundles and the composer displays the cap
- **`pnpm` is installed via `npm`.** Node 26 no longer ships `corepack`, so it cannot be assumed present — see the amended feature 38 build command
- Three landmines found and closed here rather than in a later feature: the `@theme` font tokens must reference the `next/font` variables; the named spacing tokens shadow Tailwind's container scale (`max-w-md` is 10px); and `cn()` needs `extendTailwindMerge` or it drops custom type steps

### 02 Supabase project and schema migration

Create the database exactly as specified, in one reviewable migration.

**Logic:**

- Supabase project created; local development stack running via the CLI
- Migration creating the `provider`, `message_role`, and `message_status` enums
- Migration creating `profiles`, `provider_keys`, `conversations`, `messages`, `attachments`, `prompts`, `shared_key_usage`, and `shared_key_budget` per the data model in `architecture.md`
- The `messages.search_vector` generated column and its GIN index
- All secondary indexes: sidebar ordering, thread reads, prompt tags
- The `on auth.user created` trigger that inserts a `profiles` row
- The `shared_key_budget` singleton row seeded for the current month
- `pg_cron` **and `pg_net`** enabled by migration, with both scheduled jobs registered: ten-minute quota reconciliation (pure SQL) and hourly attachment reaping (`pg_net` → Edge Function, because storage objects cannot be deleted from SQL). See the local-setup gotcha in `library-docs.md` — the extension does not install cleanly on a fresh local stack without configuring `cron.database_name` first
- `src/types/database.ts` generated from the schema

### 03 Row-Level Security policies

Enable and prove per-user isolation before any application code can come to
depend on being careful.

**Logic:**

- RLS is **already enabled** on all eight tables — feature 02 did it in the same migration that created them, so this feature only adds policies. Confirm with `list_tables` rather than re-enabling
- Owner select/insert/update/delete policies scoped to `auth.uid()` on `profiles`, `provider_keys`, `conversations`, `messages`, `attachments`, `prompts`, and `shared_key_usage`
- Write the owner check as `(select auth.uid()) = user_id`, **not** the bare `auth.uid() = user_id` shown in `architecture.md`'s examples. Postgres evaluates the bare form once per row; the subquery form is evaluated once and cached. Supabase's linter reports the bare form as `auth_rls_initplan`, and `architecture.md`'s example block needs amending to match when this lands
- No policy of any kind on `shared_key_budget` — service-role access only. Its permanent `rls_enabled_no_policy` advisor notice is correct and must not be "fixed"
- The two `anon` share-link policies from `architecture.md` land here, not at feature 33 — that feature states outright that "the anon RLS policies from Phase 0 are what make the page readable", and the anon exposure surface is best proven in one place while the test harness exists
- Storage bucket `attachments` created private, with policies matching the first path segment against `auth.uid()`
- Vitest suite that signs in as user A and asserts that every table returns zero rows belonging to user B under the anon key. Sessions come from `auth.admin.createUser()` on the service-role client followed by `signInWithPassword` — there is no local stack to seed against, and a real JWT through PostgREST is the only thing that exercises grants, policies, and PostgREST together
- **Fixtures are seeded with the service-role client**, which bypasses RLS. Seeding through the policies under test would let a broken insert policy leave the table empty, and every "cannot see B's row" assertion would then pass for the wrong reason
- **No `supabase/seed.sql`.** `supabase db reset` is what executes a seed file and feature 02 removed the local stack, so the file would never run. The suite creates and tears down its own fixtures instead

### 04 Google Sign-In

**UI:**

- Landing page at `/` with the product statement and a "Continue with Google" button
- Loading state on the button while the OAuth redirect is in flight
- An error banner when `?error=auth_failed` is present in the URL

**Logic:**

- Google OAuth provider configured in the Supabase dashboard. The authorized redirect URI belongs to **Supabase** (`https://<ref>.supabase.co/auth/v1/callback`), not to the application — `/auth/callback` is where Supabase sends the browser afterwards, and putting the app's URL in Google produces `redirect_uri_mismatch`
- **Do NOT turn off "Allow new users to sign up".** An earlier draft of this plan said to, and it is wrong: `DISABLE_SIGNUP` is global, not email-specific. Turning it off blocks new **Google** users from ever creating an account, which destroys the first success criterion in `project-overview.md`. Verified against the live project in feature 04
- **The open email-signup endpoint is bounded rather than closed.** The email provider stays enabled, because feature 03's isolation suite signs in with `signInWithPassword` against admin-created users and Supabase offers no way to disable email *signup* without also disabling email *sign-in*. What makes this safe is `mailer_autoconfirm = false`: `signUp` issues no session until the address is confirmed, so the endpoint cannot yield a JWT that spends shared Gemini quota. The residual exposure is unconfirmed `auth.users` rows. `tests/auth/auth-config.test.ts` pins all of it
- `signInWithOAuth` from the browser client
- `/auth/callback/route.ts` exchanging the code for a session
- `/auth/signout/route.ts`
- `src/proxy.ts` refreshing the session on every matching request (Next 16's rename of `middleware.ts`; the export is `proxy`, the runtime is `nodejs` and not configurable)
- `requireUser()` and `getUser()` in `src/server/auth.ts`
- Unauthenticated access to any `(app)` route redirects to `/`; a signed-in visit to `/` redirects to `/chat`

### 05 Application shell

The three-column frame every subsequent feature renders inside.

**UI:**

- `(app)/layout.tsx`: left sidebar, centre column, right outline rail
- Sidebar header with the PromptX wordmark and a "New chat" button
- Sidebar footer with the user's avatar, name, and a menu linking to Settings and Sign out
- Both side columns collapsible, with the collapsed state persisted in **a cookie, not `localStorage`**. An earlier draft of this plan said `localStorage`, and it is wrong for the very next line of this feature: the layout is a Server Component, so it cannot read `localStorage` during render. It would paint the sidebar expanded and let the client correct it after hydration — a flash on every navigation, for exactly the people who chose to close it. A cookie is read with `await cookies()` and written from the client with one line of `document.cookie`; no route handler is involved, because the server only ever reads it back
- A collapsed column leaves a 36px gutter strip carrying its restore button. `DESIGN.md` says only that the columns collapse; a fully hidden one has no way back, and a floating restore button would sit on top of the thread once feature 09 fills it
- Below 1024px the sidebar becomes a drawer and the outline rail becomes a sheet, both built on one edge-anchored `Sheet` primitive (Radix Dialog, so the focus trap, Escape, and scroll lock come for free)
- A slim `desktop:hidden` shell header carries both overlay triggers. `DESIGN.md` opens the outline "from the thread header", which does not exist until feature 09 — that feature grows this header into the real one rather than inventing a second
- Empty state in the centre column inviting the first message
- `error.tsx` and `loading.tsx` for the route group, plus a root `app/not-found.tsx`. The 404 is at the ROOT deliberately: Next resolves a path matching no route against the root not-found, so a `(app)/not-found.tsx` would only ever fire for an explicit `notFound()` inside a route that already exists. It therefore cannot render inside the shell. It is needed here because the account menu links to `/settings`, which feature 13 builds

**Logic:**

- Session enforced in the layout via `requireUser()`
- Profile data fetched server-side and passed to the sidebar. This introduces `src/server/data/profiles.ts` — the first module in that folder, one feature before feature 06 expected to create it, because the `.from()` lint rule is exempted there and nowhere else
- Collapse state in a small client component; the layout itself stays a Server Component. The sidebar and rail are passed to it as already-rendered Server Component nodes, so their markup stays in the RSC payload rather than the client bundle
- The collapse toggle lives inside each column's own header, so it reaches the state through React context — a Server Component takes no function props, and context crosses that boundary at runtime

---

## Phase 1 — Core chat

### 06 Conversation list

**UI:**

- Conversations grouped by Pinned, Today, Previous 7 days, and Older
- Each row shows the title, truncated to one line, with the relative time on hover — and always visible on coarse pointers, where there is no hover to trigger it
- The active conversation is marked with an off-white left indicator
- Skeleton rows while loading; an empty state when there are none

**Logic:**

- `src/server/data/conversations.ts` with `listConversations()` ordered by `pinned_at desc nulls last, updated_at desc`
- Grouping computed on the server, not in the client
- Archived conversations excluded from the default list

### 07 New conversation and composer

**UI:**

- Auto-growing textarea capped at roughly 40% of viewport height
- Send button, disabled while empty or while a response is streaming
- Enter sends, Shift+Enter inserts a newline
- Placeholder naming the active model

**Logic:**

- `createConversation()` in `src/server/data/conversations.ts`
- The conversation row is created on first send, not when the empty page loads, so abandoned drafts leave nothing behind
- `appendMessage()` persisting the user message before the request goes out
- Redirect from `/chat` to `/chat/[id]` once the conversation exists

### 08 Streaming responses on the shared key

The first end-to-end path. Gemini only, no quota enforcement yet.

**UI:**

- Assistant tokens appearing incrementally as they arrive
- A stop button replacing send while streaming
- An inline error state when a request fails

**Logic:**

- `/api/chat/route.ts` following the route handler pattern in `code-standards.md`
- `resolveModel()` in a first form: shared Gemini key only
- The user message is persisted **before** the provider call, and thread history is loaded server-side — the request body carries only the newest message
- `streamText` with the v7 top-level `toUIMessageStream({ stream: result.stream })` and `createUIMessageStreamResponse()`
- `useChat` with `DefaultChatTransport` and `prepareSendMessagesRequest` sending a singular `message`
- `onFinish` persisting the assistant message with its token counts
- `stop()` persisting partial content with `status = 'error'`
- `runtime = 'nodejs'`, and an `abortSignal` from `STREAM_TIMEOUT_MS` — no `maxDuration`, which is a Vercel directive and a no-op on Render

### 09 Message rendering

**UI:**

- User messages right-aligned on `canvas-soft`; assistant messages full-width on the canvas
- Markdown rendered with GFM: lists, tables, blockquotes, headings
- Code blocks with shiki highlighting, a language label, and a copy button
- Inline code in DM Mono on a subtle `canvas-soft` fill
- The model that produced each assistant message, shown in DM Mono on hover, and persistently on coarse pointers. A thread whose model changed mid-conversation is only legible if this is reachable, so it must not depend on a pointer the device does not have
- A copy button for the whole message

**Logic:**

- `MarkdownMessage` per `library-docs.md`, with raw HTML disabled
- A single shared shiki highlighter instance with a token-matched theme
- An error boundary around the renderer so a malformed streaming fragment cannot blank the thread

### 10 Auto-generated titles

**UI:**

- The sidebar title transitions from "New chat" to the generated title without a page reload

**Logic:**

- `/api/title/route.ts` calling the shared Gemini key with the first exchange and a terse titling prompt
- Fired after the first assistant message completes, never blocking the stream
- Result trimmed to `MAX_TITLE_LENGTH`, stripped of quotes and trailing punctuation
- **Quota policy:** titling does **not** claim a user slot — it is system overhead, and charging a user for a title they did not ask for is wrong. Its tokens *are* reconciled into `shared_key_budget`, because they cost real money. It is skipped entirely when the circuit breaker is tripped.
- Failure is silent — the conversation keeps "New chat" rather than surfacing an error

### 11 Delete conversation

**UI:**

- Delete in the sidebar row's overflow menu
- A confirmation dialog naming the conversation, with the destructive action in `text-danger`
- Redirect to `/chat` if the deleted conversation was open

**Logic:**

- `deleteConversation()` relying on `on delete cascade` for messages and attachments
- `revalidatePath('/chat')` after deletion

---

## Phase 2 — Bring your own key

### 12 The encryption vault

**Logic:**

- `src/server/vault.ts` per `architecture.md` — AES-256-GCM, 12-byte random IV, 16-byte auth tag
- `ENCRYPTION_KEY` validated at load — **in `src/server/env.ts`, which already does it**, not a second time in the vault
- `lastFour()` helper
- Vitest suite: round-trip correctness, unique IV across 1,000 encryptions, tampered ciphertext / auth tag / IV each rejected independently, and a malformed master key refusing to load
- No logging anywhere in the module

**Decisions taken during this feature** (see `build-journal.md` for the full entries):

- **The vault reads `serverEnv.ENCRYPTION_KEY`, never `process.env`.** `architecture.md` carried two invariants that contradicted each other — "every secret is read through `env.ts`" and "the vault is the only module that reads `ENCRYPTION_KEY`" — and its snippet re-validated the 32-byte length that `env.ts` had already proven at boot. `env.ts` won; the snippet and the invariant were both corrected in place
- **`decrypt()` throws a typed `DecryptionError` carrying no `cause`.** node's raw failure is opaque and identical for a tampered row and a rotated master key. `encrypt()` deliberately does not wrap — with a validated key it has no expected failure mode
- **The tamper tests alone do not prove integrity**, measured rather than assumed: deleting `setAuthTag` leaves all three green, and the round-trip tests are what catch it

### 13 Key management

**UI:**

- `/settings/keys` listing all four providers as rows
- Each row shows either "Not configured" or the masked key (`sk-…4f2a`) with its label and creation date
- Add and Replace open a dialog with a password-type input and a paste-friendly hint
- Remove asks for confirmation
- A validating state while the key is probed, and a clear error on rejection

**Logic:**

- `/api/keys/route.ts` with POST and DELETE
- The key is probed with a minimal, cheap provider call before storage; an invalid key is rejected with `code: 'invalid_key'` and never persisted
- `vault.encrypt()` then upsert into `provider_keys`, replacing any existing row for that provider
- `getDecryptedKey()` in `src/server/keys.ts` — server-only, returns null when absent
- The response body contains `provider`, `lastFour`, `label`, and `createdAt`, and nothing else
- Vitest asserting no route in the application returns a decrypted key

**Decisions taken during this feature** (see `build-journal.md` for the full entries):

- **The probe is a free models-endpoint call, not a generation.** Zero tokens and no model id, which matters because the catalog does not exist until feature 14. It proves the key is real and authorised; it does not prove inference is enabled, which is the accepted gap — and that gap stays open past F14, which gave the key a place to be *used* rather than a second place to be checked
- **Two probe failures, kept apart, both failing closed.** `401`/`403` → `400 invalid_key`; a timeout, a 5xx, or a network error → `503 probe_unavailable`. Neither writes a row. Collapsing them tells a user their correct key is wrong because a provider had a bad minute
- **`bytea` is hex over PostgREST.** The conversion lives only in `src/server/data/provider-keys.ts`. Passing a `Buffer` to supabase-js silently stores `{"type":"Buffer",…}` and reports success — proven by mutation, not assumed
- **This feature also built `/settings/account`**, which no feature in this plan owns. It is specified in `project-overview.md` ("profile details and sign-out") and built read-only to that line. **Editing `display_name` is still unbuilt and unassigned** — the data model calls the column editable and no feature specifies the path

### 14 Provider registry and model catalog

**Logic:**

- `src/lib/models.ts`: a curated catalog per provider with display name, model id, context window, and capability flags (`supportsImages`, `supportsPdf`)
- `resolveModel()` extended to all four providers per `architecture.md`
- `MissingKeyError` thrown when a provider is selected without a key
- OpenRouter ids validated as namespaced (`vendor/model`)
- Vitest: each provider resolves with a key; a keyless non-Google provider throws; a keyless Google request with a non-shared model id throws

**Decisions taken during this feature** (see `build-journal.md` for the full entries):

- **The catalog is an enforcement boundary, checked in `resolveModel()` and nowhere else.** A model absent from it throws `UnknownModelError` → `400 unknown_model`. Not in `chatRequestSchema` as well: one rule in two files is two rules free to drift, which is the lesson F12 already paid for
- **The `vendor/model` check became a test on catalog data rather than a runtime branch.** Membership is strictly stronger than a `/` check, so the branch would be dead code; what it was really guarding — a namespaced id pasted under a native provider — is an authoring mistake, and `tests/lib/models.test.ts` catches it
- **Every shipped id was listed live and then proven by generating.** Two different things: Google's endpoint still lists `gemini-2.5-flash`, which answers "no longer available to new users". That id was used as a deliberate control and failed as expected
- **`openai` and `anthropic` ship as empty catalogs**, with no key available to prove an id for either. The accepted consequence is that a valid OpenAI or Anthropic key still cannot send a message — so the refusal names the empty catalog instead of blaming the model id. **Populating them is unassigned work that F15 will make visible** as two empty picker groups
- **OpenRouter needs `compatibility: 'strict'`**, which is not the factory default. At the default it omits `stream_options: { include_usage: true }` and every OpenRouter message would persist with null token counts, which F17's ledger would read as free

### 15 Model picker

**UI:**

- A picker in the composer showing the current model in DM Mono
- Grouped by provider; providers without a key are shown disabled with an "Add key" link
- Gemini Flash is always available and labelled "Shared"
- Selecting a model updates the conversation and persists

**Logic:**

- The set of configured providers fetched server-side and passed as props
- `updateConversationModel()` persisting `provider` and `model_id`
- Switching models mid-conversation preserves full history; only subsequent messages record the new model

**Decisions taken during this feature** (see `build-journal.md` for the full entries):

- **What the picker greys out and what `resolveModel()` refuses are the same function.** `isSharedModel()` in `src/lib/models.ts`, called from both. Two independent spellings of one rule disagree invisibly — a picker offering a model every send then rejects, or hiding one that works
- **Selection is keyed on `(provider, modelId)`, never the id alone.** `Gemini 3.6 Flash` is in the catalog twice, under `google` and `openrouter`, with different ids and different bills. Radix carries one string per radio item, so the pair is encoded into it — split on the *first* separator, since a model id may contain a colon
- **"Shared" appears only while no Google key is configured.** Once one exists that model is billed to its owner, and the marker would be a lie. Rendered as mute caption text rather than DESIGN.md's `status-chip`, which is `canvas-soft` on a menu that is also `canvas-soft`
- **The "Add key" row is deliberately not a disabled item.** `ITEM_BASE` carries `data-disabled:pointer-events-none`, so a Radix-disabled item cannot hold a working link — the one affordance on that row that has to work
- **`PATCH` checks the catalog too.** Otherwise a conversation can be left holding a model every later send refuses, which reads as a thread that stopped working
- **A model change does not touch `updated_at`.** The sidebar orders on activity, and changing the model is not activity

### 16 Shared-key quota

**UI:**

- A remaining-count indicator in the composer, appearing at `QUOTA_WARNING_THRESHOLD` in `text-warn`
- At zero: the composer is disabled with "You've used your 20 free messages for today" and a link to `/settings/keys`
- The current day's usage shown on `/settings/keys`

**Logic:**

- `src/server/quota.ts` with `reserveSharedSlot()`, `releaseSharedSlot()`, and `recordSharedKeyTokens()`
- The `reserve_shared_slot` Postgres function claiming a slot in one conditional upsert — the `where message_count < limit` clause on the `do update` branch is the race guard, and it must not be replaced with a preceding `select`
- The slot is reserved **before** the provider call and released if the stream fails or is aborted, so a failed generation is never charged
- `QuotaExceededError` mapped to `429` with `code: 'quota_exceeded'`
- Users with their own key bypass reservation entirely
- Vitest at the boundary: the 19th and 20th succeed, the 21st is refused; a release restores exactly one slot and cannot drive the counter below zero
- Vitest concurrency test: 10 simultaneous reservations against a user sitting at 19 must yield exactly one success and nine refusals. **This could not be honoured** — requests to the hosted project serialise, so no window exists for a second statement to land inside. Measured, not assumed: a deliberately racy read-then-write implementation with a one-second sleep between the read and the write kept the test green. See F16 in `build-journal.md`; proving atomicity needs a local stack or F36

**Decisions taken during this feature** (see `build-journal.md` for the full entries):

- **F16 is the per-user axis only.** Reserve, release, and a `record_shared_tokens` that writes `shared_key_usage` and nothing else. `shared_key_budget`, `estimated_usd`, the breaker and `createServiceRoleClient()` all wait for F17 — so the only RLS-bypassing client in the codebase still does not exist
- **The meter is always visible while the shared key would answer**, shifting to `text-warn` at the threshold and `text-danger` at zero. `DESIGN.md` describes the text as *shifting*, which presupposes it was already on screen; this plan's "appearing at `QUOTA_WARNING_THRESHOLD`" would leave that shift nothing to shift from
- **Exhausted locks the composer only on a shared-key model.** This bullet list predates F15's picker. Disabling outright would refuse sends `resolveModel()` accepts happily, locking a user out of a key they pay for over an allowance their request never touches
- **`willUseSharedKey()` joins the availability family in `src/lib/models.ts`** — the meter's visibility, the exhausted lock, and the server's reservation are three readings of one rule
- **A reservation is released when persistence fails**, not left to the sweep. The sweep exists for a process that died, not for a failure the handler can see

### 17 Global circuit breaker

**UI:**

- When tripped, keyless users see "Shared access is temporarily unavailable" with a link to add their own key
- Users with a key see nothing and are unaffected

**Logic:**

- `recordSharedKeyTokens()` accumulating tokens into `shared_key_budget` and computing `estimated_usd` from the Gemini Flash rate card in `src/lib/constants.ts`
- `tripped_at` set when `estimated_usd` exceeds `SHARED_KEY_MONTHLY_USD_CEILING`
- `reserveSharedSlot()` checking the breaker **before** claiming a slot, returning `503` with `code: 'budget_exhausted'` — a tripped breaker must not consume a user's daily allowance
- `reconcile_shared_key_usage()` **already exists** — feature 02 shipped it, because feature 02 registers the `cron.schedule` call that invokes it and a job pointing at a missing function fails every ten minutes. Its lowering-only behaviour and staleness guard were verified there against seeded drift. This feature only needs to confirm it still holds once real reservations exist
- **Feature 10's titling spend is this feature's responsibility, and nothing else will catch it.** F10 shipped `generateConversationTitle()` with two marked hooks it could not fill, because `quota.ts` did not exist yet: skip generation entirely while the breaker is tripped, and pass the `usage` it currently discards to `recordSharedKeyTokens()`. The reconciliation sweep is **not** a fallback here — it derives usage from `messages` rows carrying `used_shared_key`, and a title writes no message row, so titling tokens are invisible to it by construction. Until this lands, every generated title is unmeasured spend on the billed key
- Only measured token usage is written to the ledger. A provider failure that reports no usage records nothing and logs a warning; estimates never enter a table that drives a circuit breaker
- Vitest: an orphaned reservation is released by reconciliation, and a reservation younger than the staleness window is left untouched
- The month rolling over resets the accumulator and clears `tripped_at`
- The only permitted use of `createServiceRoleClient()` in the codebase

---

## Phase 3 — Conversation craft

### 18 Message outline rail

**UI:**

- The right column lists every user prompt in the conversation, truncated to two lines
- Clicking scrolls the thread to that exchange with a brief highlight
- The entry matching the current scroll position stays marked
- Collapsible; a sheet below 1024px
- Hidden when the conversation has fewer than three exchanges

**Logic:**

- User messages derived from the already-loaded thread — no extra query
- Scroll position tracked with `IntersectionObserver`, throttled
- Each message anchored by a stable `id` for deep linking

### 19 Edit and resend

**UI:**

- An edit action on hover over a user message, and persistently visible on coarse pointers — without this the whole feature is unreachable on a touch device
- The message becomes an inline textarea with Save and Cancel
- Saving warns that subsequent messages will be removed
- The thread truncates and the new response streams in

**Logic:**

- `updateMessageAndTruncate()` — one transaction updating the content and deleting every message with a later `created_at` in that conversation
- A fresh completion requested from the truncated history
- The outline rail rebuilds automatically

### 20 Regenerate

**UI:**

- A regenerate action on the last assistant message
- An optional "with a different model" submenu

**Logic:**

- `useChat`'s `regenerate()`
- The previous assistant message is deleted before the new one is persisted
- When a different model is chosen, only this message records it — the conversation's default is unchanged

### 21 Rename and pin

**UI:**

- Rename in the sidebar overflow menu turns the title into an inline input
- Pin toggles, moving the conversation into the Pinned group with a small indicator

**Logic:**

- `renameConversation()` capped at `MAX_TITLE_LENGTH`
- `togglePin()` setting or clearing `pinned_at`
- A manual rename permanently suppresses auto-titling for that conversation

### 22 Archive

**UI:**

- Archive in the overflow menu; the conversation leaves the sidebar
- A "Show archived" toggle in the sidebar footer reveals them, visually muted
- Unarchive restores it to its recency group

**Logic:**

- `toggleArchive()` setting or clearing `archived_at`
- `listConversations()` takes an `includeArchived` flag, defaulting to false
- Archived conversations remain fully readable and searchable

### 23 Per-conversation system prompt

**UI:**

- A system prompt control in the thread header, showing "Default" or a truncated preview
- Opens a dialog with a textarea and a character count against a 10,000 cap
- A "Save to prompt library" shortcut (wired in Phase 4)

**Logic:**

- `updateSystemPrompt()` persisting to `conversations.system_prompt`
- Passed as `system` to `streamText` on every subsequent request
- Changing it affects future messages only; history is untouched

---

## Phase 4 — Prompt library and search

### 24 Prompt library

**UI:**

- `/prompts` as a grid of cards showing title, a body preview, and tags
- Create and edit in a dialog with title, body, and tag inputs
- Filter by tag; search by title
- Delete with confirmation
- An empty state explaining what the library is for

**Logic:**

- `src/server/data/prompts.ts` with full CRUD
- `/api/prompts/route.ts` and `/api/prompts/[id]/route.ts`
- Tags normalised to lowercase and deduplicated on save

### 25 Insert a prompt into the composer

**UI:**

- A library button in the composer opening a searchable list
- Selecting a prompt inserts its body at the cursor
- Keyboard-navigable: type to filter, arrows to move, Enter to insert

**Logic:**

- Prompts fetched once per session and held in client state
- Insertion is plain text into the textarea — no templating or variable substitution in v1

### 26 Full-text search backend

**Logic:**

- The `search_messages` Postgres function per `library-docs.md`, `security invoker` so RLS applies
- `websearch_to_tsquery` for query parsing, `ts_rank` for ordering, `ts_headline` for snippets
- `searchMessages()` in `src/server/data/messages.ts`
- Results capped at `SEARCH_RESULT_LIMIT`
- Vitest against a seeded set of 5,000 messages asserting sub-500ms response and correct ordering

### 27 Search interface

**UI:**

- `/search` with a query input focused on load
- Results grouped by conversation, each showing role, snippet with `<mark>` highlights, and relative time
- Clicking a result opens the conversation scrolled to that message
- Distinct empty states for "no query yet" and "no matches"
- ⌘K from anywhere opens search

**Logic:**

- The query lives in the URL (`/search?q=…`) so results are linkable and the back button works
- Debounced navigation as the user types
- Highlight markup rendered safely — only `<mark>` is permitted, never arbitrary HTML

---

## Phase 5 — Attachments

### 28 Upload pipeline

**Logic:**

- The private `attachments` bucket with its owner-scoped storage policies (created in Phase 0, wired here)
- **Set the bucket's `file_size_limit` and `allowed_mime_types`.** Feature 03 left both null and this is where they get set. They matter more than they look: uploads go client-direct to Storage through signed URLs, so application code is never in the byte path. Validating mime and size when *issuing* the signed URL does not constrain what actually lands — the bucket-level limits are the only thing enforcing `MAX_ATTACHMENT_BYTES` at the moment of upload
- `/api/attachments/route.ts` issuing a signed upload URL scoped to `{user_id}/{attachment_id}` — and, for images, two more for `_thumb` and `_inline`
- Mime type checked against `ALLOWED_ATTACHMENT_MIME_TYPES` and size against `MAX_ATTACHMENT_BYTES`, server-side, for every object including the derivatives
- **Derivatives generated in the browser before upload**, via `createImageBitmap` into an `OffscreenCanvas` and `convertToBlob({ type: 'image/webp' })`: an 80px square `_thumb` and a 1440px longest-edge `_inline`. This keeps the direct-to-storage design intact — the Node process never receives an image byte, and no transform ever lands on the request path. Server-side resizing would put the work on the single free instance that is also serving streams
- A browser that cannot produce a derivative falls back to uploading the original alone, leaving `thumb_path` and `inline_path` null; the renderer treats null as "use the original"
- PDFs skip derivation entirely and keep both columns null
- An `attachments` row created with `status = 'pending'`, a null `message_id`, and a `position`; it flips to `'ready'` on confirmed upload and is linked when the message is sent
- `MAX_ATTACHMENTS_PER_MESSAGE` (4) enforced server-side at send time, not only in the composer
- Only `'ready'` rows are attached; a `'pending'` or `'failed'` row is reported to the user rather than silently dropped
- The hourly `pg_cron` job **already exists** — feature 02 registered it, calling `public.reap_attachments_tick()`, which reads two Vault secrets and returns early while they are absent. To activate it, create both with `vault.create_secret()` under exactly these names: **`reap_attachments_edge_url`** (the deployed function's URL) and **`reap_attachments_service_key`**. No new `cron.schedule` call is needed
- The `reap-attachments` Edge Function implemented and deployed: it selects rows with a null `message_id` older than `ATTACHMENT_ORPHAN_TTL_HOURS`, removes **`storage_path`, `thumb_path`, and `inline_path`** through the **Storage API**, and only then deletes the rows. It must not be a SQL job — `delete from storage.objects` strands the file, manufacturing the exact leak the reaper exists to prevent. Collecting only `storage_path` does the same thing to the two derivatives
- Batched at 1,000 paths per `remove()` call, with a failed storage delete aborting before any row is removed
- Short-lived signed URLs for reads, generated server-side

### 29 Attachment interface

**UI:**

- A paperclip button and drag-and-drop onto the composer
- Thumbnails for images from `thumb_path`, a file chip for PDFs, each with a remove control
- A per-file upload progress indicator
- Attachments rendered inside the sent message from `inline_path`; images open in a lightbox showing the original from `storage_path`
- Every image renders through `next/image` with `unoptimized` — the sizes are already correct, and the Next optimizer would burn CPU on the instance serving streams to redo work done at upload time
- Clear errors for oversized or unsupported files

**Logic:**

- Upload begins on selection, before send, so the send is instant
- Removing a pending attachment deletes the row and **all three** of its storage objects; if that cleanup fails, the row is left to the reaper rather than retried in a loop
- A failed upload sets `status = 'failed'` and offers a retry, and blocks send with a clear message rather than sending without it
- Attachments render in `position` order, both in the composer and in the sent message
- Attachments converted to AI SDK file parts on send

### 30 Capability gating

**UI:**

- The attach button is disabled with a tooltip when the selected model accepts no files
- Switching to a text-only model with attachments pending warns before dropping them

**Logic:**

- `supportsImages` and `supportsPdf` read from the catalog in `src/lib/models.ts`
- The server independently rejects file parts sent to a model that cannot accept them — the client-side gate is convenience, not enforcement

---

## Phase 6 — Compare, share, export

### 31 Compare view

**UI:**

- `/compare` with one prompt input and two model pickers
- Two columns streaming simultaneously, each labelled with its model
- Independent stop controls per column
- A per-column error state that does not disturb the other
- Below 1024px the columns stack

**Logic:**

- `/api/compare/route.ts` resolving both models independently
- Two `streamText` calls multiplexed into one response, tagged `left` and `right`
- Each side quota-checked separately; one side may be refused while the other proceeds
- **No conversation and no messages are persisted.** Nothing appears in the sidebar and nothing is recoverable after leaving the page. The quota ledgers are the deliberate exception: a shared-key comparison reserves and reconciles on both sides, because two real provider calls were made and someone paid for them

### 32 Promote a comparison

**UI:**

- "Continue with this one" beneath each column
- Navigates to a new conversation containing the prompt and the chosen answer

**Logic:**

- A conversation created with the winning side's provider and model
- The user prompt and the chosen assistant response persisted as the first two messages
- The discarded side is never written anywhere

### 33 Public share links

**UI:**

- A share control in the thread header opening a dialog
- Toggling on generates a URL with a copy button; toggling off revokes it immediately
- Clear text stating the link is public to anyone who has it
- Shared conversations carry an indicator in the sidebar
- `/share/[slug]` renders read-only: no composer, no model picker, no owner identity, attachments shown as placeholders

**Logic:**

- `share_slug` generated with `nanoid(SHARE_SLUG_LENGTH)`; `shared_at` set alongside. A non-null slug *is* the shared state — no separate boolean
- Insert retries on a unique violation up to `SHARE_SLUG_MAX_RETRIES`, then fails the request. Never an unbounded loop, never a non-random fallback
- The anon RLS policies from Phase 0 are what make the page readable — no service-role client
- Revoking nulls both columns; the old slug 404s immediately. Re-sharing mints a **new** slug — a revoked URL is never reinstated
- `/share/[slug]` declares `export const dynamic = 'force-dynamic'` and sends `Cache-Control: private, no-store`, so a revoked page cannot be served from a static build, an ISR entry, or an edge cache. It is excluded from `cacheComponents` if that flag is ever enabled
- A Playwright test confirming a logged-out browser sees the conversation, that a revoked slug 404s, and that no other route is reachable

### 34 Export

**UI:**

- Export in the thread overflow menu, offering Markdown or JSON
- Downloads immediately

**Logic:**

- Markdown: title as an H1, then role-labelled sections with the model noted per assistant message, code fences preserved
- JSON: the full conversation with messages, models, and timestamps; no user id and no key material
- Generated server-side in a route handler, streamed as a download

---

## Phase 7 — Hardening and release

### 35 Unit test suite

**Logic:**

- Coverage completed across `src/server/`: vault, quota, providers, keys, and every `data/` module
- The RLS isolation suite from Phase 0 extended to every table added since
- Provider calls mocked at the `resolveModel()` boundary — no test spends money
- `pnpm test` green from a clean checkout

### 36 End-to-end suite

**Logic:**

- Four Playwright specs: sign in, send a message and receive a stream, add a key and confirm only `lastFour` is displayed, exhaust the shared quota and see the wall
- Run against the hosted Supabase project, with fixtures created and torn down by the specs themselves. There is no local instance and no `seed.sql` — feature 02 removed the local stack and feature 03 established the admin-create-then-sign-in pattern these specs should reuse
- Provider responses intercepted with `page.route()`
- `pnpm test:e2e` green from a clean checkout

### 37 Accessibility and responsive pass

**UI:**

- Every interactive element reachable and operable by keyboard, with a visible focus ring
- The thread is a live region so streaming text is announced
- Every icon-only button has an accessible name
- Dialogs trap focus and restore it on close
- All text verified at WCAG AA against `--color-canvas`
- Verified at 360px, 768px, 1024px, 1440px, and 1920px
- Verified with a coarse pointer emulated at 1024px — an iPad in landscape gets the desktop layout without hover, so every hover-revealed control must still be reachable there
- No control or information is hover-only anywhere in the app: audit every `hover:` that changes opacity, visibility, or display for a `pointer-coarse:` counterpart
- A 200-message conversation scrolls without jank

**Logic:**

- Axe run over every route with no serious or critical violations outstanding
- `prefers-reduced-motion` respected by every transition

**Performance budget** — measured against a **warm** instance, so the free-tier
wake is excluded and the numbers describe the app rather than the plan:

- Lighthouse Performance ≥ 90 on `/` and on a signed-in conversation
- LCP ≤ 2.5s, CLS ≤ 0.1, INP ≤ 200ms
- First-load JS ≤ 200KB gzipped on `/`; the landing page ships no client component that is not needed for sign-in
- A 200-message conversation stays within budget — this is the page most likely to breach it
- `next build` output reviewed for any route whose first-load JS is disproportionate, with `next/dynamic` applied to the offenders
- Every `next/image` verified to carry `unoptimized` and explicit dimensions

### 38 Deployment

**Logic:**

- `render.yaml` Blueprint committed, defining a single Node Web Service:
  - Build: `npm i -g pnpm@$(node -p "require('./package.json').packageManager.split('@')[1]") && pnpm install --frozen-lockfile && pnpm build`. **Do not use `corepack enable`** — Node no longer bundles Corepack (verified absent on Node 26 during feature 01), so it cannot be assumed present on Render's build image either, and the failure mode is a build that dies with `pnpm: not found`. Reading the version out of `packageManager` keeps the same pinning guarantee Corepack gave. Confirm the actual Node version on the build image and simplify to `corepack enable` only if it is old enough to still ship it
  - Start: `pnpm start` (`next start` binds `PORT` automatically — never hardcode it)
  - Health check path: `/api/health`
  - Region matched to the Supabase project's region
  - `rootDir: .` — the Next app *is* the repo root. Pointing this at a subdirectory excludes files from build and runtime entirely, so `rootDir: src` would fail on a missing `package.json`. It is a monorepo setting and this is not a monorepo
  - `buildFilter.ignored` covering `context/**`, `*.md`, and `.claude/**`, so a documentation commit does not rebuild and restart the service. On the free tier a restart hands the next visitor a ~60s cold start, which is a real cost for a change that alters no runtime behaviour
  - Use `ignored`, never `included` — an include list is fail-open in the wrong direction, silently dropping deploys for any path nobody remembered to list. A `buildFilter` fully replaces existing settings on sync, so the committed file is the whole truth rather than a patch on dashboard state
  - Every secret declared `sync: false`, so values live in the dashboard and never in the committed file
- `/api/health` route returning `{ ok: true }` with no auth, no database read, and no build metadata
- Supabase production project migrated, with Google OAuth redirect URLs and the Supabase Auth redirect allowlist updated to the Render domain
- `NEXT_PUBLIC_SITE_URL` set to the final URL **before** the build that ships — `NEXT_PUBLIC_*` is inlined at build time, so changing it later needs a rebuild, not a restart
- `pg_cron` confirmed running in production: `select * from cron.job_run_details` shows both jobs succeeding, not merely scheduled
- **A hard budget cap set on the Google Cloud billing account backing `SHARED_GEMINI_API_KEY`.** The in-app circuit breaker is best-effort — it reconciles measured tokens and can undercount. The provider-side cap is what actually guarantees the bill, and it is not optional
- `ENCRYPTION_KEY` generated fresh for production and stored only in Render's environment settings
- **Free tier, cold start accepted** — the decision is already made in `architecture.md` → "The cold-start problem"; this feature implements it rather than revisiting it. The landing page must read honestly on a waking instance: no client-side fetch, no above-the-fold image, nothing that defers meaningful paint
- Lighthouse run against production on a **warm** instance, confirming the feature 37 budget survives the real network and the real region — a local run flatters both
- A production smoke test **from a cold instance**: wait out the spin-down, then sign in, send a message on the shared key, add a key, and share a conversation. Streaming behaves differently on a cold process than a warm one, and this is the path a first-time visitor actually takes
- `README.md` rewritten with setup instructions, the architecture summary, and a screenshot

---

## Feature Count

| Phase | Features |
| ----- | -------- |
| Phase 0 — Foundation | 5 |
| Phase 1 — Core chat | 6 |
| Phase 2 — Bring your own key | 6 |
| Phase 3 — Conversation craft | 6 |
| Phase 4 — Prompt library and search | 4 |
| Phase 5 — Attachments | 3 |
| Phase 6 — Compare, share, export | 4 |
| Phase 7 — Hardening and release | 4 |
| **Total** | **38** |
