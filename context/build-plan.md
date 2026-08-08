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

**Decisions taken during this feature** (see `build-journal.md` for the full entries):

- **`estimated_usd` is derived from the cumulative token totals, never accumulated per call.** Measured: one title-sized call is $0.00051, which stores as $0.0005 in a `numeric(10,4)` column — so ten of them come to $0.0050 accumulated against a true $0.0051. The stronger reason is that a separately accumulated dollar column would be a second independent record of the same fact, free to drift from the tokens it claims to price
- **The availability check is scoped to the current `period_month`, and omitting that term is a deadlock rather than a slow reset.** A breaker tripped in one month would refuse in the next, and the reset that would clear it lives on a write path the refusal itself blocks
- **The breaker check lives inside `reserveSharedSlot()`, not at its call site**, so no path can claim a daily slot without checking first. Proven by the assertion that a tripped breaker never even constructs the reservation client
- **`isSharedKeyAvailable()` fails open**, because the authoritative spend cap is the provider-side budget limit (feature 38) and failing closed would trade a real outage for a few hypothetical cents
- **Titling writes `shared_key_budget` only**, through a `recordSharedBudgetTokens()` that takes no user id — the same structural trick as `sharedTitleModel()`. Observed end to end: one message left `message_count = 1` while the ledger held 462 tokens against the message's own 88
- **Two pages outside §17's UI list were corrected**, because both stated the daily allowance as a fact that is false while tripped: `/settings/keys` and `/chat`'s empty state

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

**Decisions taken during this feature** (see `build-journal.md` for the full entries):

- **The rail is a sibling of the thread, so it needed a channel rather than a prop.** `OutlineRail` is slotted into `AppShell` by the `(app)` layout while the messages live in `Chat`, a Client Component inside `children` — neither is an ancestor of the other. `AppShell` is the nearest component above both and was already a Client Component, so it holds the outline: `Chat` publishes, the rail reads. That is what makes "no extra query" literally true — the entries are the same `useChat` array the thread renders, not a second read of the same rows. A parallel route slot (`@rail`) was rejected for needing its own `listByConversation` and only refreshing on `router.refresh()`
- **`OutlineRail` became a Client Component, narrowing an F05 constraint rather than breaking it.** The shell hands both columns to `AppShell` as rendered Server Component nodes so their markup stays in the RSC payload; that reasoning does not reach a column whose content is derived from browser-only state and has no server markup to preserve. The sidebar's arrangement is untouched
- **Message anchors carry hand-written ids; rail items carry `aria-current`.** This looks like it violates F06's "no hand-written `id` in a shell column" and does not — that rule exists because below 1024px a column is in the document twice, once as the `display:none` desktop aside and once as the mounted sheet. `children` renders once. Measured with the sheet open at 800px: two rail lists in the DOM, zero duplicate ids document-wide
- **Position, not crossings, decides the active entry.** The first draft kept "the last anchor to cross the reading line", which is right scrolling down and wrong scrolling up — scrolling back past a prompt leaves it as the most recent crossing while the reader is above it. Recording where each anchor *is* is direction-independent. Measured both ways: the marker holds on one prompt through a long answer (scrollTop 400→2000) and walks back 3→2→1→0 on the way up
- **The entries memo is load-bearing and keyed on content, not ids.** Measured across comparable streams: 1 publish with it, 14 without. Keyed on `id:label` rather than ids alone because feature 19 edits a prompt in place — same id, new text — and an id-only key would leave the rail showing the old wording
- **An exchange is one prompt, and "hidden" unmounts the whole column** — aside, 36px gutter, and the mobile trigger together. A gutter whose restore button restores nothing is worse than no gutter, and it removes the placeholder sentence the rail used to show on `/settings`

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

**Decisions taken during this feature** (see `build-journal.md` for the full entries):

- **The truncation lives inside `/api/chat`, below the "will reach a provider" line.** This is the whole feature. An edit is the first destructive write in the application, so the ordering rule that used to prevent a dangling prompt now prevents a destroyed conversation. `chatRequestSchema` gained an optional `editMessageId` rather than a `PATCH /api/messages/[id]` being added, because a separate endpoint puts the delete on the far side of the refusal path. Proven by mutation: moving it above `resolveModel()` and sending an edit with the allowance spent returned the *same* 429 and took the thread from six messages to three
- **Shipped as `edit_message_and_truncate`, a `security invoker` plpgsql function.** PostgREST cannot span a transaction (F07), and an update that lands without its delete leaves a prompt followed by the answer to the question it used to be. Grants match the quota functions — revoked from `public`/`anon`, granted to `authenticated` — in a second migration, because Postgres grants execute to `public` by default and the first one inherited it
- **The thread's order became total: `(created_at, id)`.** "Every message after this one" needs a definition of *after*, and `created_at` alone was not one. The plan's fix — excluding the target by id — was wrong in the other direction and would have deleted an *earlier* tied row; making the order total instead means truncation and display agree by construction. `listByConversation()` now orders on both, and the two must stay in step
- **A tie test that looked right was flaky, and the mutation run is what exposed it.** With equal timestamps the tiebreak is a random uuid, so the answer sorted after the prompt only about half the time. Rewritten with four fixed ids as two deterministic assertions — the tied row after the prompt is removed, the tied row before it survives and still reads in order
- **`sendMessage` does not reject on a refusal**, measured against the installed SDK: `makeRequest` catches, calls `onError`, and sets `status: 'error'`. The optimistic truncation is therefore undone by an effect watching `status`, not by a `.catch()` — which would have compiled, looked correct, and never once run
- **`prepareSendMessagesRequest` was silently dropping the per-call body.** It built its body from scratch and ignored the `body` argument, so `editMessageId` never reached the server: the client truncated its view while the server appended, and the two only disagreed after a reload. Caught by checking the database rather than the screen
- **The confirmation appears only when something would be lost**, and names the count. Editing the last prompt removes nothing, and a dialog that warns about deleting nothing is one people learn to dismiss without reading

### 20 Regenerate

**UI:**

- A regenerate action on the last assistant message
- An optional "with a different model" submenu

**Logic:**

- `useChat`'s `regenerate()`
- The previous assistant message is deleted before the new one is persisted
- When a different model is chosen, only this message records it — the conversation's default is unchanged

**Decisions taken during this feature** (see `build-journal.md` for the full entries):

- **`regenerate()` supplies its own discriminator, and reading it is the feature.** Measured off the installed SDK rather than the docs: `regenerate({ messageId })` slices the assistant message out of client state *before* calling the transport, then sets `trigger: 'regenerate-message'`. So `messages[messages.length - 1]` is by then the **user's prompt**, and F08's `prepareSendMessagesRequest` — which sends that unconditionally — would have asked the server to append a prompt it already stores. The thread would hold the same question twice, the screen would look perfect, and only a reload would disagree. `trigger` is what the branch keys on, so unlike F19's per-call body there is no flag a caller can forget
- **`chatRequestSchema` became a union of two `.strict()` branches**, and strict is the load-bearing half. `z.union` tries members in order and an ordinary zod object *strips* undeclared keys, so without it a body carrying both `message` and `regenerateMessageId` matches the send branch, loses the regenerate id, and is handled as an ordinary send — the duplicate-prompt bug arriving through the schema instead. Proven by mutation: removing `.strict()` from the send branch turns exactly one test red and leaves the other ten green
- **The destructive write is a single `DELETE` by primary key, and needs no migration.** The route proves above the provider line that the target is the *last* message and an assistant row; that makes "everything after it" empty, so F19's `(created_at, id)` truncation rule has nothing to decide and is not copied here. One statement is atomic on its own, so no transaction is needed either — and if the follow-up insert fails, the thread shows the prompt with no answer, which is the state the user asked for
- **Reads may live above the "will reach a provider" line; only writes may not.** `listByConversation()` was hoisted so the regenerate branch can refuse a bad id before a quota slot is claimed. The edit path still re-reads *after* truncating — a copy taken above the line would be the pre-delete thread, the one thing it must not send to the model
- **The model chosen for a regeneration is a per-call body override and nothing else.** Nothing on that path calls `useModelMutation`, so the conversation row and the composer's picker are untouched and only the new assistant row records what answered
- **The regenerate menu is gated by the composer's rule, and the composite is written twice on purpose.** Both read `isModelAvailable` and `willUseSharedKey` — the shared definitions — but the composer needs to know *why* it is blocked so it can say so in a sentence, while the menu only needs yes or no per model. Two readings of one primitive, which is the F16 shape, not two copies of a rule
- **Offered on a failed or stopped answer, not only a completed one.** That is the likeliest reason anyone reaches for it, and withholding it there leaves retyping the prompt as the only way back

### 21 Rename and pin

**UI:**

- Rename in the sidebar overflow menu turns the title into an inline input
- Pin toggles, moving the conversation into the Pinned group with a small indicator

**Logic:**

- `renameConversation()` capped at `MAX_TITLE_LENGTH`
- `setConversationPinned(id, pinned)` setting or clearing `pinned_at` — desired state, not a toggle, so a retry or a double-click cannot undo itself. The plan said `togglePin()`; the rename is the decision below
- A manual rename permanently suppresses auto-titling for that conversation

**Decisions taken during this feature** (see `build-journal.md` for the full entries):

- **No migration, and two thirds of the "logic" was already there.** `pinned_at` and `conversations_sidebar_idx` shipped in F02; `listConversations()` already orders `pinned_at desc nulls last`, and `groupConversations()` already files a pinned row into the Pinned bucket exclusively. Auto-title suppression is **inherited, not written** — `setGeneratedTitle()` gates on `.eq('title', DEFAULT_CONVERSATION_TITLE)`, so a renamed conversation is skipped without a column recording that a human named it. F21's job there was to pin it with a test, and it got one that goes red when the `.eq()` is removed
- **The PATCH body became a union of three `.strict()` branches** — model, rename, pin — the shape F20 gave `chatRequestSchema`, for the same reason: `z.union` tries members in order and an ordinary zod object *strips* undeclared keys, so a body carrying both `title` and `pinned` would match the first branch and be answered as a rename that never happened. Proven by mutation: dropping `.strict()` from the model branch turns exactly that test red. F22's archive slots in as a fourth branch
- **`.trim()` is declared before `.min(1)`, and the order is the guard.** Measured on the installed zod 4.4.3 rather than assumed: checks run in declaration order, so trim-first rejects `'   '` while trim-last accepts it and stores `''` — a conversation with no name and nothing to say why. The mutation swapping them turns two tests red together
- **Neither rename nor pin writes `updated_at`**, the F15 argument applied twice. The sidebar orders on *activity*, and naming something is not activity; for pin it bites harder, because a touch would reorder the row inside the Pinned group for a click that produced no message. Verified in the database on every browser check, not inferred
- **The rename input is focused from Radix's `onCloseAutoFocus`, not an effect.** The obvious version was written first and measured not to work: the input mounts while the menu is still open, and the trapped FocusScope pulls focus straight back out — the input rendered correctly with `document.activeElement` on `BODY`
- **Escape is a `window` capture listener, because the drawer eats it otherwise.** Radix dismisses a Sheet from `document.addEventListener('keydown', …, { capture: true })` — read out of the installed package — which runs before React's root listener, so `stopPropagation()` in a React handler is already too late. The first version did exactly that and cancelling a rename at 360px closed the whole sidebar with it. `window` is one step above `document` in the capture path
- **A cancelled rename left a flag set that silently ate the *next* rename's blur commit.** React fires no blur for an element it unmounts, so the `cancelledRef` that Escape sets was never cleared, and the following rename on that row kept its typed title on screen while the database never heard about it. Found in the browser, not by reading. The flag is now cleared where the rename *starts*
- **The pin indicator is a leading glyph, not DESIGN.md's `status-chip`.** The chip's fill is `canvas-soft` and so is the row's hover and active fill, so a "Pinned" chip would vanish exactly when the row is being used. It is `aria-hidden`: the enclosing `<ul aria-label="Pinned">` already tells a screen reader which group the row is in

### 22 Archive

**UI:**

- Archive in the overflow menu; the conversation leaves the sidebar
- A "Show archived" toggle in the sidebar footer reveals them, visually muted
- Unarchive restores it to its recency group

**Logic:**

- `setConversationArchived(id, archived)` setting or clearing `archived_at` — desired state, not a toggle, for the reason F21 settled. The plan said `toggleArchive()`
- `listConversations()` takes an `includeArchived` flag, defaulting to false
- Archived conversations remain fully readable and searchable

**Decisions agreed before building** (see `build-journal.md` for the full entries):

- **A fourth `.strict()` branch on `updateConversationSchema`**, which F21 built the union expecting. `{archived: boolean}` sits beside model, rename and pin, and the route narrows with `'archived' in`
- **"Show archived" is a cookie**, per the F05 constraint that shell layout state is a cookie and never `localStorage` — `(app)/layout.tsx` reads it during the server render and passes the flag into `listConversations()`, so the right list is in the first byte. It is the first cookie here whose write **must** be followed by `router.refresh()`: collapse state is mirrored in React state, so its server re-render is cosmetic, while this one decides a *query*
- **`Archived` is exclusive and checked before `Pinned` in `labelFor()`, and renders last.** Archiving does not clear `pinned_at`, so unarchiving restores a pinned row to `Pinned` exactly as it was — which is what "restores it to its recency group" has to mean for a row that had been lifted out of recency
- **Archiving the conversation on screen leaves you on it.** Unlike delete, which `router.replace('/chat')`s because the URL would 404, an archived thread is still valid and still readable; navigating away would discard something that still works
- **No new UI primitive and no migration.** The toggle is a `Button` with `aria-pressed` rather than a shadcn Switch, per the Dependencies gate; `archived_at` shipped in F02 and `conversations_sidebar_idx` carries no partial predicate, so the archived-inclusive query reads off the same index the default one does

### 23 Per-conversation system prompt

**UI:**

- A system prompt control **in the composer row, beside the model picker**, showing "Default" or a truncated preview. The plan said "thread header"; see the decision below
- Opens a dialog with a textarea and a character count against a 10,000 cap
- ~~A "Save to prompt library" shortcut~~ — deferred to F24, where the library it saves to actually exists

**Logic:**

- `updateSystemPrompt()` persisting to `conversations.system_prompt`
- Passed as `system` to `streamText` on every subsequent request
- Changing it affects future messages only; history is untouched

**Decisions agreed before building** (see `build-journal.md` for the full entries):

- **The control lives in the composer, not a thread header, because no desktop thread header exists.** `AppShell`'s header is `desktop:hidden`, and DESIGN.md's only "thread header" reference is that mobile bar — so building one would be new chrome with no design spec, existing solely for this control. The composer already holds the per-conversation "what the next message will use" state (the model picker) and is pinned at every width
- **A fifth `.strict()` branch, `{systemPrompt: string | null}`.** Explicit null is how the prompt is cleared — null is what the column stores and what "Default" means, so an empty-string convention would need a second rule to translate it. Empty or whitespace-only normalises to null in the schema, `.trim()` declared first per F21
- **On `/chat` the prompt rides in the first request body, and the server honours it only when *creating* the conversation.** Same shape the model picker already uses. The guard is the load-bearing half: for an existing conversation the route reads the row and ignores any `systemPrompt` in the body, because without that the field becomes a per-request override — a different feature, and one that would let a stored prompt be bypassed silently
- **`updateSystemPrompt()` does not touch `updated_at`**, the fourth feature running to apply that rule. Changing an instruction is not activity
- **No per-message column and no migration.** Unlike F15's per-message model, which exists for billing and attribution, a system prompt has neither pressure behind it — and it would duplicate up to 10,000 characters per row

---

## Phase 4 — Prompt library and search

### 24 Prompt library

**UI:**

- `/prompts` as a grid of cards showing title, a body preview, and tags
- Create and edit in a dialog with title, body, and tag inputs
- Filter by tag; search by title
- Delete with confirmation
- An empty state explaining what the library is for
- **A nav block in the sidebar, under "New chat"**, because nothing in the application links to `/prompts` and a page reachable only by typing its URL is not done. Not in this list originally; see the decision below

**Logic:**

- `src/server/data/prompts.ts` with full CRUD
- `/api/prompts/route.ts` and `/api/prompts/[id]/route.ts`
- Tags normalised to lowercase and deduplicated on save
- **F23's deferred "Save to prompt library" shortcut**, which that feature struck from its own list with the note that it belongs here

**Decisions agreed before building** (see `build-journal.md` for the full entries):

- **No migration.** `prompts`, its four owner RLS policies, `prompts_user_id_idx` and `prompts_tags_idx` all shipped in F02 and have never been used by anything. The one thing F02 did not give the table is a trigger on `updated_at`, so the update function writes it explicitly
- **`updated_at` *is* written on edit**, reversing the rule four conversation writes follow — and for the same reason, read correctly. The sidebar orders conversations on *activity* and renaming one is not activity; the prompt grid orders on `updated_at` because for a prompt, editing it **is** the activity
- **The sidebar gets a nav block, not another item in the account menu.** `project-overview.md` already says the sidebar holds the links to Prompts, Search and Settings, so the slot is built once here and F27's Search and F31's Compare drop into it. A client leaf for the `usePathname` active state only, so `Sidebar` stays a Server Component and F05's slotting arrangement is untouched
- **Filtering happens in the browser over the loaded set.** The page reads every prompt once server-side and one client leaf narrows it in memory — no round trip, no debounce. F25 wants the same set "fetched once per session and held in client state", so this is that read arriving one feature early. The accepted cost is that filters are not linkable, unlike F27's `/search?q=`, which is a ranked query over thousands of message rows and belongs in the URL
- **"Search by title" means the title, and one tag filters at a time.** Body search would overlap F26's `search_messages`, which is `tsvector`-ranked rather than substring; multi-tag filtering needs an AND/OR rule nobody has specified
- **`PATCH /api/prompts/[id]` takes one strict object carrying all three fields**, not a union of partial branches. The dialog edits title, body and tags together, so partial branches would be machinery with no caller — `updateConversationSchema` is a union because five genuinely separate intents converge on one row, which is not the case here
- **F23's shortcut is an inline reveal inside the system-prompt dialog, not a second dialog and not a toast.** Nesting a Radix `Dialog` inside one puts the new input inside an already-trapped `FocusScope`, which is what F21 spent three rounds on; `sonner` is approved but not installed, and F24 is not where a dependency arrives. Pressing "Save to library" swaps in a title field pre-filled from the prompt's first line, and confirmation is a line of text
- **Tag chips on a card drop their `status-chip` fill.** `prompt-card` is `canvas-soft` and so is `status-chip` — the invisible-container trap F15 and F16 both hit. The chips keep the pill shape and caption type and take a hairline border instead

### 25 Insert a prompt into the composer

**UI:**

- A library button in the composer opening a searchable list
- Selecting a prompt inserts its body at the cursor
- Keyboard-navigable: type to filter, arrows to move, Enter to insert

**Logic:**

- Prompts fetched once per session and held in client state
- Insertion is plain text into the textarea — no templating or variable substitution in v1

**Decisions agreed before building** (see `build-journal.md` for the full entries):

- **A new `GET /api/prompts`, fetched on the picker's first open.** F24's route file predicted the opposite — "a JSON read endpoint would be a second path to the same rows with nothing calling it" — and that comment is corrected in place here rather than worked around, because the condition it named no longer holds. Server-rendering the library into both chat pages was the alternative and it puts every prompt *body*, up to 10,000 characters each, into the RSC payload of every chat load for a panel most loads never open. That is the cost `listConversations()` selects four columns to avoid, with no CDN in front of the origin
- **A module-level cache, invalidated by `usePromptMutation`.** `Chat` remounts per conversation, so component state would make "once per session" quietly mean "once per conversation". Busting the cache inside F24's existing mutation hook covers create, edit and delete in one line
- **A new `popover.tsx` vendored from `radix-ui`, plus a hand-rolled listbox.** F24 declined a listbox for its tag field and took a native `<datalist>` — correct there, where the keyboard list was a convenience. Here it is the specification. A `DropdownMenu` cannot carry it: Radix menus own typing for their own typeahead and arrows for item navigation, so a filter input inside one fights the primitive. Non-modal, and **no exit keyframe**, per the F05 constraint
- **The picker's search matches title *and tags*; `/prompts` still matches titles only.** Two rules rather than two spellings of one, and the difference is structural — the page has a tag filter row beside its search box and the picker has no room for one, so tags fold into the query or become unreachable. A separately named `searchPrompts()` with both behaviours pinned by tests, so the divergence stays deliberate
- **The composer's auto-grow has to be extracted first.** The textarea resizes inside `handleChange`, which does not run for a programmatic `setText`, so an inserted multi-line prompt would land in a one-row box. Invisible until something long is inserted

### 26 Full-text search backend

**Logic:**

- The `search_messages` Postgres function per `library-docs.md`, `security invoker` so RLS applies
- `websearch_to_tsquery` for query parsing, `ts_rank` for ordering, `ts_headline` for snippets
- `searchMessages()` in `src/server/data/messages.ts`
- Results capped at `SEARCH_RESULT_LIMIT`
- Vitest against a seeded set of 5,000 messages asserting sub-500ms response and correct ordering

**Decisions agreed before building** (see `build-journal.md` for the full entries):

- **The snippet carries no HTML, and `StartSel`/`StopSel` are control-character sentinels rather than `<mark>`.** `ts_headline` does not escape the document it summarises — measured against this project before deciding: `<script>` was stripped but `<img src=x onerror=alert(2)>` came through verbatim, and fragment selection cut another tag in half leaving `onerror=alert(1)>`. F27 splits on the sentinels into real React elements, so nothing downstream ever holds a string it might pass to `dangerouslySetInnerHTML` and §27's "only `<mark>` is permitted" is true by construction rather than by rule. `library-docs.md`'s snippet is amended in place with the finding
- **The 5,000-message suite asserts correctness; the speed claim is measured with `EXPLAIN ANALYZE` and recorded rather than asserted.** There is no local stack, so a wall-clock assertion runs from a laptop to ap-southeast-1 and measures the network — green with a bad plan on a fast connection, red with a good one on a slow connection. F16 established what a test that cannot fail is worth; the honest instrument here is the planner's own timing plus confirmation that `messages_search_idx` is used
- **"No searchable terms" and "no matches" are different answers.** A stopword-only query parses to an empty `tsquery`, which is detectable in SQL; a second tiny function reports it, called only when the result set is empty. That keeps `search_messages` the shape `library-docs.md` documents and puts the extra round trip on the path that was already a dead end
- **Ordering is `ts_rank desc, created_at desc, id desc`.** Rank leads because §26 says so; the tiebreakers make the order total, which matters more here than in F19 — ranks collide far more often than timestamps do
- **No new index unless `EXPLAIN` demands one.** `messages_search_idx` is a plain GIN on `search_vector` and RLS adds a `user_id` predicate it cannot serve. At this scale that is speculation, so the plan decides and the finding is recorded either way
- **Conversation titles are not searchable.** `search_vector` covers `messages.content` only; a conversation is found by the messages in it. Archived conversations *are* searchable, which F22 states outright and a test pins

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

**Decisions agreed before building** (see `build-journal.md` for the full entries):

- **The target message travels as `?m=<uuid>`, read by the conversation page and consumed once.** `/chat/[id]` already awaits `searchParams`, so it passes the id into `Chat`, which runs the `jumpTo` F18 already owns — including its 1.2s highlight, so the message announces itself rather than merely being on screen. The param is stripped with `router.replace` after use, so a reload does not re-jump. A hash was the alternative and needs an effect anyway: Next does not reliably scroll to a target that hydrates after the transition, and it would arrive without the highlight
- **Debounced navigation uses `router.replace`, never `push`.** Every intermediate query as a history entry makes Back walk `d`, `de`, `dep` — the classic version of this bug. Replace keeps the URL linkable while Back returns to wherever the user came from, which is what "the back button works" has to mean
- **Assistant messages gain the scroll anchor they have never had.** Only `UserMessage` renders `outlineAnchorId`, because F18 only ever needed to jump to prompts. Search returns both roles, so without this half the results would have had nothing to scroll to
- **⌘K navigates to `/search` rather than opening a command palette.** A palette cannot call `searchMessages()` from the browser, so it would need a `GET /api/search` that F26 deliberately did not build, and it would duplicate this page's UI. The listener is on `window` with `capture`, the F21 finding, so a Radix dismissal listener on `document` cannot swallow it
- **Three empty states, not two.** §27 names "no query yet" and "no matches"; F26 supplies a third — a query of only stopwords, which is neither, and which reads as a broken search if collapsed into "no matches"
- **F26's flat 30-result cap stays, and grouping makes its limit visible.** One conversation can occupy the page. Accepted and recorded rather than fixed: if a conversation genuinely holds the 30 best matches that is the true answer, and a per-conversation cap would re-migrate a function shipped two commits earlier while letting a worse match outrank a better one for being elsewhere
- **Grouping is presentation, never re-ranking.** A group appears at the position of its best-ranked hit and hits within it stay in rank order

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

**Decisions agreed before building** (see `build-journal.md` for the full entries):

- **The send path lands here, not in F29.** `chatSendSchema` gains a strict optional `attachmentIds`. The checks — at most `MAX_ATTACHMENTS_PER_MESSAGE`, every row owned, `'ready'`, and not already linked — sit **above** the "will reach a provider" line, because they are reads and a refusal must leave the thread untouched; only the link itself sits below. A not-ready id is `400 attachment_not_ready` rather than a silent drop, and a missing or unowned one is `404`, per the F11/F15 rule that confirming an id exists but is not yours is itself a disclosure. F29 adds the paperclip and the AI SDK file parts on top of a rule that is already enforced
- **`position` is assigned at link time from the index in `attachmentIds`**, not carried on the draft. A draft's position would be a client's claim about an order it is still free to change, and `attachments_message_position_idx` is unique over `(message_id, position)` — so the order the composer last showed is the only one that can be correct
- **`'ready'` is a measured fact, not a client's word.** The confirm call reads each object's metadata back out of Storage, refuses `409 upload_incomplete` if any is absent, and writes `size_bytes` and `mime_type` from what actually landed. Same posture as F17's ledger: without it a client can talk a row into `'ready'` for a file that does not exist, spend a quota slot, and fail at the provider
- **Every Storage call lives in `src/server/data/attachments.ts`.** Not preference: `eslint.config.mjs` restricts `CallExpression[callee.property.name='from']` outside `src/server/data/**` and excludes only `Array`, `Buffer` and `Object`, so `supabase.storage.from(…)` trips it everywhere else. The exempt folder is the right home anyway — one module holding both the paths and the rows is what keeps "every path that deletes an attachment deletes all three objects" true
- **The reaper runs two passes, and the second is the one architecture.md promised.** Pass 1 is §28's orphan rows; pass 2 deletes objects with no row at all, which is the only cleanup that can reach files stranded by a cascade — deleting a conversation cascades to messages and then to attachment rows, and SQL cannot touch the bucket. Candidates come from a `security invoker` function in `public` granted to `service_role` only, because PostgREST does not expose the `storage` schema; it reads `storage.objects` and deletes nothing. Both passes are age-bounded so an upload in flight is never swept, and batching counts **paths**, not rows — an image is three, so pass 1 takes at most 333 rows per run
- **The two Vault secrets are created with `execute_sql`, never a migration.** `reap_attachments_service_key` is a service-role key and `supabase/migrations/` is committed
- **Remove, retry and `status = 'failed'` stay in F29**, which owns them; §28 names failed rows only as something the send path must refuse. An abandoned upload here is cleaned by the reaper, which is the fallback the data model already specifies. Editing a message carries no attachments either — `attachmentIds` is on the send branch alone
- **No `GET` route for read URLs.** Signed reads are a function in the data module, called by F29's Server Component; an endpoint with nothing calling it is what F24 declined and F25 only reversed once the condition changed

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

**Decisions agreed before building** (see `build-journal.md` for the full entries):

- **Every turn that has attachments carries file parts, not just the newest one.** A conversation about an image is unusable otherwise, and the failure is silent — the model answers confidently about nothing. The accepted cost is that the same image is re-sent and re-billed each turn, which on the shared key spends the daily allowance faster than text does
- **The bytes are fetched server-side and inlined; no signed URL ever reaches a provider.** A signed URL handed to Google is a bearer token for a user's private file sitting in a third party's logs for its lifetime. It is rarely even cheaper: when a provider does not accept arbitrary URLs the AI SDK downloads them through this process anyway, so passing a URL becomes the same byte path with less control over when
- **The model is sent `inline_path`, not the original.** 1440px webp is ample for a model and a fraction of the bytes, which matters precisely because it is re-sent every turn. PDFs and derivative-less images fall back to `storage_path`
- **The server builds those file parts from the rows it has already validated, never from the client's message parts.** `chatSendSchema` stays text-only and `.strict()`; a file part the schema accepted would let a client hand the model arbitrary content, which is the same class of thing as rewriting its own history
- **Attachments travel beside the messages, keyed by message id — not as SDK parts.** `Chat` holds a map seeded from the server; on send the entry is keyed to the client-minted id and moved when `data-prompt-message` reports the real row, reusing F19's re-keying exactly. Without it a just-sent message shows nothing until a navigation, because `router.refresh()` does not touch `useChat` state
- **Progress is real bytes, via `XMLHttpRequest`** — `fetch` cannot report upload progress at all — weighted across the original and its two derivatives
- **Failure is local plus a delete, and the persisted `'failed'` status therefore stays unused.** A failed upload deletes all three objects and then the row, and the chip offers a retry that starts a fresh draft. The check constraint keeps the value available, but nothing writes it and nothing reads it: the send path already refuses anything that is not `'ready'`, so a status no code consults would be bookkeeping pretending to be a state machine
- **A migration adds `inline_width` and `inline_height`**, because `code-standards.md` requires explicit dimensions on every `next/image` and nothing recorded them. **Client-reported and cosmetic-only** — a wrong value costs a layout wobble, not a breach — which is the one deliberate exemption from F28's measured-not-claimed rule
- **`ATTACHMENT_READ_URL_TTL_SECONDS` goes to one hour**, matched to how long a page is plausibly left open rather than to how long a request takes
- **Capability gating stays in F30.** F29 can send a PDF to a text-only model and get the provider's own error; the catalog flags exist and nothing reads them yet

### 30 Capability gating

**UI:**

- The attach button is disabled with a tooltip when the selected model accepts no files
- Switching to a text-only model with attachments pending warns before dropping them

**Logic:**

- `supportsImages` and `supportsPdf` read from the catalog in `src/lib/models.ts`
- The server independently rejects file parts sent to a model that cannot accept them — the client-side gate is convenience, not enforcement

**Decisions agreed before building** (see `build-journal.md` for the full entries):

- **The catalog gains a genuinely text-only model, because otherwise nothing here can be reached.** Every entry shipped by F14 sets both flags true, so the disabled button, the tooltip, the warning and the server refusal would all be unreachable and unverifiable — the "guard with nothing to refuse" F28 recorded, arriving by construction this time. Listed on the evidence of `architecture.input_modalities` being `["text"]` from OpenRouter's models endpoint, then **proven by a real send through the application**: the key lives encrypted in the vault and only the server can decrypt it, so F14's curl is not available. Same standard, different road. An entry that does not answer comes back out
- **One definition, three readers.** `acceptedMimeTypes(provider, modelId)` is the primitive; "accepts no files" is an empty result and "accepts this file" is membership in it. The attach button, the file input's `accept`, the switch warning and the server's refusal all read it — the `isSharedModel` / `willUseSharedKey` shape, for the same reason: two spellings of one rule disagree invisibly
- **The gate is per file type, not per model.** The button is disabled only when the model accepts *neither* — §30's own "accepts no files" — and a model that reads images but not PDFs keeps a live button with a narrowed `accept`. Anything coarser makes one of the two flags dead data
- **The attach button uses `aria-disabled`, never `disabled`.** A disabled button fires no pointer events, so a Radix tooltip on one never opens — the tooltip explaining why it is disabled would be the single unreachable thing on screen
- **Switching drops only the incompatible files, and drops means deletes** — row and all three objects, the path F29's remove control already takes. An `AlertDialog` per the F11 rule names the count first; cancelling leaves both the model and the files alone
- **The server check sits above the "will reach a provider" line** with F28's other attachment checks, so a refusal writes nothing. It runs only when `findModel()` returns a model, leaving an unknown id to `resolveModel()`'s `unknown_model` rather than answering it with a confusing capability error
- **History file parts are filtered rather than refused.** A model that cannot read an earlier image simply does not receive it, so one image in turn one does not bar every text-only model from the conversation forever. The cost is stated rather than hidden: the model silently cannot see something the thread visibly contains, and nothing on screen says so
- **A test pins that at least one entry accepts nothing**, so a future catalog tidy-up cannot quietly return this feature to being decorative with nothing failing

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

- `/api/compare/route.ts` resolving one model per request, through `resolveModel()` like every other generation
- Each column posts its own request, so each is quota-checked separately; one may be refused while the other proceeds
- **No conversation and no messages are persisted.** Nothing appears in the sidebar and nothing is recoverable after leaving the page. The quota ledgers are the deliberate exception: a shared-key comparison reserves and reconciles on both sides, because two real provider calls were made and someone paid for them

**Decisions agreed before building** (see `build-journal.md` for the full entries):

- **Two independent POSTs, not one multiplexed response.** This section and `architecture.md`'s data flow both said "two `streamText` calls multiplexed into one response, tagged `left` and `right`" until F31, and the same section asked for independent stop controls and a per-column error state — which one response cannot give. One response carries one `request.signal`, so a per-column stop could only stop *rendering* while the provider kept generating and billing, the exact failure F08 composed its abort signal to prevent; and a per-column refusal could not be an HTTP status, so `quota_exceeded` would have to be smuggled into a 200 as a data part. Two requests give independent stop, independent 400/429/503 and independent quota with no new machinery. The server never hears the words `left` and `right` — the side is a client concept
- **The reconciliation sweep has to learn about slots that produce no message row, or the daily cap does not apply here at all.** `reconcile_shared_key_usage()` sets `message_count` to the number of complete shared-key assistant messages for that day, on any row untouched for five minutes. A comparison persists nothing, so every slot it claimed would be handed back within ten minutes and `/compare` would spend the shared key without bound. A migration adds `shared_key_usage.compare_count`, moved inside the same atomic statement as `message_count`, and the sweep's `actual` becomes `messages + compare_count`. `message_count` stays the single enforcement counter, so chat and compare share one allowance and `getTodaysUsage()` needs no change. The cost, stated rather than hidden: a compare slot orphaned by a dead process no longer self-heals in ten minutes — the row is per `usage_date`, so it clears at 00:00 UTC
- **`resolveModel()` takes the flag rather than the route claiming its own slot.** An options argument, `{ persisted: false }`, passed through to `reserveSharedSlot`. Keeping the reservation inside `resolveModel()` is what preserves the invariant that no route constructs a provider client or claims a slot directly
- **The model-error mapping is extracted, not copied.** `modelErrorPayload()` in `src/server/providers.ts`, which owns the error classes, returns `{ status, body }` for the four refusals and null for anything else. It returns data rather than a `Response` so that shaping the response stays in the route, where `code-standards.md` puts it. `/api/chat` moves onto it in the same change
- **One `useChat` per column**, `compare-left` and `compare-right`, each with its own transport. `status`, `stop` and `error` are already per instance, which is the whole reason two requests are cheap to consume
- **The right column defaults to the first available model that is not the left one**, falling back to the shared model when the user holds no keys. Both defaulting to `SHARED_MODEL_ID` would make the out-of-the-box action a comparison of one model against itself, for two of twenty daily messages
- **No attachments and no system prompt.** §31 names one prompt input, so F30's capability gate has nothing to gate here
- **A consequence for §32, recorded now rather than discovered then:** with nothing persisted, "Continue with this one" has to send the server an assistant answer it never stored, which brushes against the invariant that history is never taken from the request body. §31 only needs to hold the prompt and both answers in client state

### 32 Promote a comparison

**UI:**

- "Continue with this one" beneath each column
- Navigates to a new conversation containing the prompt and the chosen answer

**Logic:**

- A conversation created with the winning side's provider and model
- The user prompt and the chosen assistant response persisted as the first two messages
- The discarded side is never written anywhere

**Decisions agreed before building** (see `build-journal.md` for the full entries):

- **The client sends the answer, and the history invariant is narrowed to say so.** F31 persists nothing, so the chosen text exists only in the browser. The rule — "history is never taken from the request body; a client must not be able to rewrite its own past turns" — is about a **generation** request, and exists to stop a client steering the next completion with a fabricated past. `/api/compare/promote` calls no provider, so there is no completion to steer. The invariant gains an explicit exception naming this route. The cost is stated rather than buried: a crafted request can store an assistant turn the model never produced, in the caller's own conversation, and §33 will make that publicly shareable. That is the price of a compare view that persists nothing, and it is the same trust already extended the moment the text left the browser
- **No `resolveModel()` and no quota reservation, deliberately.** Every other write path resolves a model first because every other one is about to spend somebody's money; this one spends nothing. It still validates catalog membership with `findModel()` and refuses `unknown_model`, because a conversation holding a model id the sender will refuse is a thread that cannot be replied to — F14's rule
- **The promoted assistant row carries `used_shared_key: false`, even when the shared key really did produce it.** Load-bearing arithmetic rather than bookkeeping. The sweep computes `actual = count(complete shared assistant messages) + compare_count`, and F31 already recorded that generation in `compare_count`. Marking the row `true` counts one spend twice, and because the sweep only ever *lowers*, the inflated floor silently blocks a legitimate refund: after one comparison and one promotion, a genuinely orphaned chat slot that day never comes back. `false` keeps `compare_count` the single record of that spend
- **`provider` and `model_id` are recorded as claimed, validated against the catalog.** Once the answer text is trusted the label costs no further trust, and writing null would break "every assistant message records the provider and model that produced it" for every promoted thread
- **A dedicated `POST /api/compare/promote`**, not a branch of `/api/chat` — whose every path ends in a provider call — and not a Server Action, which this project uses nowhere
- **A stopped column may be promoted, and its partial text is stored `complete`.** The user chose that text as the answer; `error` would put a failure badge on something nothing failed at
- **`requestTitle` is extracted from `Chat.tsx` rather than copied.** Two copies of an endpoint contract is how they drift. `src/lib/titles.ts` is pure normalisation and the wrong home for a fetch, so it becomes `src/components/chat/request-title.ts`

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
