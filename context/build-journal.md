# Build Journal

> **Role:** Two records in one file — the constraints that still bind, and the dated log of how the build got here.
> **Read Standing Constraints** before any decision that might conflict with past work; **append to the Feature Log** after every completed feature.
> **Relates to:** logs the features in `build-plan.md`; receives decisions displaced from `progress-tracker.md`.

## How this file is maintained

This file holds two records with different lifetimes. Keep them separate — the
whole point is that Standing Constraints stays short and findable while the
Feature Log absorbs the churn.

**Standing Constraints — permanent, topical, deduped.**

- Grouped by **topic** (auth, data, payments…), never by date. Add a `###` topic heading when a new one is needed.
- Holds only what still binds: decisions that constrain future work, and notes explaining why something non-obvious is the way it is.
- **Receives decisions displaced from `progress-tracker.md`** — when Key Decisions would exceed 10 bullets, its oldest entry is filed here under its topic.
- Cite the feature each bullet came from, e.g. `(F02)`.
- **Never pruned by age.** Remove a constraint only when it is verifiably dead — reversed by a later decision, or the thing it describes no longer exists.

**Feature Log — chronological, compacted.**

- **Append a dated entry after every completed feature**, under the current phase: decisions made, gotchas hit, verification results.
- **Compact at every phase checkpoint, never continuously.** When a phase closes:
  1. **Promote** anything from that phase that still binds into Standing Constraints, filed under its topic.
  2. **Collapse** the phase's per-feature entries into a handful of summary bullets.
  3. **Drop every `Verified:` line** — it has done its job once the next feature passes.
- Only the current phase keeps full per-feature detail. Earlier phases stay compacted, newest first.

Compaction is recoverable: this file is committed, so `git` history holds every
detail ever removed. Compact confidently.

## Standing Constraints

<!-- Filed by topic, newest bullet first within each topic:

### {{TOPIC}}
- {{CONSTRAINT}} ({{FEATURE_REF}})

-->

### Auth

- **`DISABLE_SIGNUP` is global, and must stay off.** Supabase's "Allow new users to sign up" toggle sits beside the email provider in the dashboard, but it governs every provider — turning it off stops new **Google** users from creating an account, which is the opposite of what this product needs. There is no per-provider email-signup switch: the only email control is the provider itself, and disabling that kills `signInWithPassword` and F03's isolation suite with it. (F04)
- **The open `/auth/v1/signup` endpoint is bounded, not closed, and the bound is `mailer_autoconfirm = false`.** A stranger can create an unconfirmed `auth.users` row (and a junk `profiles` row through the trigger), but no session is issued until the address is confirmed, so nothing reaches `/api/chat`. If autoconfirm is ever switched on, that becomes a real JWT-minting hole — which is why `tests/auth/auth-config.test.ts` asserts the flag directly rather than trusting the memory of this decision. (F04)
- **Google's authorized redirect URI is Supabase's, not the app's.** `https://<ref>.supabase.co/auth/v1/callback` goes in the Google Cloud console; `/auth/callback` is only where Supabase forwards the browser afterwards. Entering the app's URL yields `redirect_uri_mismatch`. (F04)
- **Every redirect is built from `SITE_URL`, never from the request's origin.** Render terminates TLS at a proxy, so `new URL(request.url).origin` inside a route handler can be the internal address. Supabase's own example works around this with an `x-forwarded-host` dance; using the configured site URL avoids the class of bug entirely. (F04)
- **`src/proxy.ts` refreshes cookies and never authorises.** Route protection lives in `(app)/layout.tsx` and in each route handler, independently. Nothing may be inserted between `createServerClient` and `await supabase.auth.getUser()` in the proxy — that call is what rotates the token. (F04)

### Database access

- **`public.handle_new_user()` is the one sanctioned `security definer` function in this codebase.** `library-docs.md` forbids `security definer` without a written reason; this is that reason. The function is fired by an insert on `auth.users`, executes as the auth admin role, and must write into `public.profiles` — there is no invoker-rights formulation that can do this, because the inserting role has no rights on `public`. It is written defensively for a reason Supabase states outright: **a trigger that raises blocks signup.** Hence `set search_path = ''` with every name fully qualified, a `coalesce` chain over the Google identity's metadata keys, and `on conflict (id) do nothing`. `execute` is revoked from `public`, `anon`, and `authenticated`. Any *further* `security definer` function needs its own entry here. (F02)
- **`shared_key_budget` gets no RLS policy — not in F03, not ever.** RLS is enabled and no policy is defined for any role, which makes the table unreachable through the anon key by construction rather than by rule. It is a global counter with no owner, so there is no `auth.uid()` to scope a policy to. The Supabase advisor reports `rls_enabled_no_policy` against it permanently; that notice is correct and must not be "fixed". (F02)
- **Extensions are created `with schema extensions`.** A bare `create extension pg_net` registers into `public` and trips the linter's `extension_in_public`. `pg_cron` is the exception — Supabase places it in `pg_catalog` and it publishes through its own `cron` schema. (F02)

- **Every RLS policy uses `(select auth.uid())` and is scoped `to authenticated`.** The bare `auth.uid()` is volatile to the planner and re-evaluated once per row; the subquery form is cached as an InitPlan. The role clause stops owner policies applying to `anon`, where they would overlap the share policies on `conversations` and `messages` and force Postgres to OR them per row. Both mistakes are functionally correct and quietly slow, which is why they are rules rather than judgement calls. The linter names them `auth_rls_initplan` and `multiple_permissive_policies`. (F03)
- **Two tables deviate from the uniform owner shape, on purpose.** `profiles` has no insert policy (the `security definer` trigger creates the row) and no delete policy (deleting it orphans the user against a surviving `auth.users` row that will never fire the trigger again). `shared_key_usage` has no delete policy — dropping that row is precisely how a user would reset their own daily allowance. Both are narrowings; do not "restore consistency" by adding the missing commands. (F03)
- **An owner can read their own `provider_keys.ciphertext`, `iv`, and `auth_tag` through PostgREST.** RLS is row-level, not column-level. Accepted, not overlooked: it is the user's own key material and is undecryptable without `ENCRYPTION_KEY`, which never leaves the server. A column-level `revoke` would close it but break `getDecryptedKey()` (F13), which must use the user-scoped client because the service-role client is reserved for `quota.ts`. (F03)
- **The `attachments` bucket is private and stays private.** Storage paths must begin with the owner's user id, because the object policies match on the first path segment and nothing else — a path built any other way is unreachable by its own owner. (F03)

### Shell and layout

- **Shell layout state is a cookie, never `localStorage`.** `(app)/layout.tsx` is a Server Component, so it can read a cookie during render and emit the collapsed markup in the first byte. `localStorage` is unreadable until after hydration, which would paint the sidebar expanded and snap it shut on every navigation — for exactly the people who chose to close it. Read with `await cookies()`, written with one line of `document.cookie`; no route handler, because the server only reads it back. Names and values are in `src/lib/constants.ts`. (F05)
- **Sheet motion is entry-only. Never add a closing animation.** Radix defers unmounting a closing element to an `animationend` whenever the computed `animation-name` changes on close. When that event does not arrive, the overlay unmounts while the panel stays on top of the page, visible and interactive — observed directly, with Escape leaving the sidebar stranded at `data-state="closed"` and no animation running. With no exit keyframe the name stays `none` and Radix unmounts at once. A CSS transition is not a substitute: Radix listens for `animationend`, never `transitionend`. (F05)
- **The sidebar and rail reach `AppShell` as rendered Server Component nodes, not as imported components.** That is what keeps their markup in the RSC payload instead of the client bundle, which matters because no CDN sits in front of the origin. The consequence to remember: they cannot receive callbacks, so the collapse toggles read state through React context instead. (F05)
- **A collapsed column leaves a 36px gutter strip holding its restore button.** Not in `DESIGN.md`, which says only that the columns collapse. A fully hidden column has no way back, and a floating restore button would overlap the thread once F09 fills it. (F05)
- **The 404 lives at `app/not-found.tsx`, at the root, and cannot be moved inside the shell.** Next resolves a path matching no route against the root not-found; a `(app)/not-found.tsx` fires only for an explicit `notFound()` inside a route that already exists. Anything else would mean a catch-all route existing purely to fake it. (F05)

### Testing

- **The browser tool is the `playwright-cli` skill.** The Playwright MCP server was removed and replaced by it; `CLAUDE.md` and `library-docs.md` pointed at the dead MCP for a while, which is how F06 came to record its whole visual pass as *Not verified* — the extension was not connected, the MCP was gone, and the skill that was available the entire time went unchecked. Check the skill list before concluding a browser is out of reach. It is a debugging tool only: `@playwright/test`, `playwright.config.ts`, and `e2e/` still arrive at F36. Sign-in is Google OAuth, so open with `--persistent --profile` or `state-load` a saved session. (F06)
- **Component behaviour has no automated coverage, and will not until F36.** `vitest.config.ts` matches `tests/**/*.test.ts` only — no `.tsx`, no jsdom, no React Testing Library — and Playwright arrives at F36. Anything UI-shaped is verified in a browser and recorded as such; the testable residue is pure helpers, which is why F05 extracted `resolveDisplayName()` and `initialOf()` into `src/lib/utils.ts` rather than inlining them. Do not report a UI feature as "tested" on the strength of `pnpm test`. (F05)
- **Unit tests live in `tests/`, and `server-only` is aliased to an empty stub under Vitest** — otherwise every `src/server/` module throws at import time, before a single assertion runs, for a reason unrelated to what is being tested. The stub must stay empty; the real guard still does its job at build time. (F01)
- **Data and policy tests run against the hosted project and own their fixtures.** There is no local stack and no `seed.sql`. The pattern, established in `tests/rls/isolation.test.ts` and to be reused by every later data test: `auth.admin.createUser({ email_confirm: true })` on the service-role client with a `crypto.randomUUID()` email, then `signInWithPassword` on a publishable-key client to get a real JWT, then assertions through that client. `afterAll` deletes the users and the cascade clears the rest. (F03)
- **Seed fixtures with the service-role client, never through the policies under test.** If seeding goes through a policy that is broken, the table ends up empty and every "cannot see the other user's row" assertion passes for entirely the wrong reason. (F03)
- **Delete storage objects before deleting an auth user.** Supabase refuses to delete a user who still owns objects, and reports it as a generic delete failure that looks nothing like the cause. (F03)
- **Vitest ships in Phase 0, Playwright at F36.** F03's RLS suite needs the former; nothing needs browser binaries until there is a spec to run. (F01)
- **A test suite that has never failed proves nothing.** The RLS suite was verified by weakening a policy to `using (true)`, confirming exactly the two expected tests went red, and restoring it. Any future change to these policies should be checked the same way. (F03)

### Quota and limits

- **The two quota limits are `NEXT_PUBLIC_*`, and the prefix is load-bearing.** Next inlines only that prefix into client bundles, and the composer displays the daily cap — unprefixed, the UI would fall back to its default while the server enforced the configured number, and the two would disagree silently with nothing to indicate it. Neither value is a secret. The cost is that both are inlined at build time, so changing either on Render needs a rebuild rather than a restart. (F01)

### Design system

- **Never use a named width utility.** The `DESIGN.md` spacing tokens shadow Tailwind's container scale, so `max-w-md` is 10px and `max-w-xs` is 4px — the shadowing is silent, with no error and just a collapsed element. Widths are numeric on the 4px grid (`max-w-112` = 448px), enforced by an ESLint rule. (F01, extended F05)

- **The `@theme` font tokens reference the `next/font` CSS variables, never the family names.** `next/font` emits two families per face — the real one and a metric-matched fallback with an ascent/descent override — and only the CSS variable names both, in order. Writing the literal `Inter` still finds the self-hosted face but skips the fallback and drops to `system-ui` while the webfont loads, which is the exact layout shift `next/font` exists to prevent. (F01)

- **shadcn primitives are retuned in place, with no alias layer.** `globals.css` carries only the PromptX `@theme`; the CLI's `:root`/`.dark`/`@theme inline` layer was deleted wholesale and each primitive hand-edited. One vocabulary, and a freshly added component looks visibly wrong until it is retuned — which is the intended forcing function, not an inconvenience to work around. (F01)

### Tooling

- **`corepack` is not assumed to exist.** Node 26 does not ship it, so it cannot be assumed present on Render's build image either, and the failure mode is a build that dies with `pnpm: not found`. `pnpm` is installed via `npm`, and F38's build command reads the version out of `packageManager` to keep the pinning guarantee Corepack would have given. (F01)

### Quota

- **`reconcile_shared_key_usage()` shipped early, in F02 rather than F17**, because F02 registers the `cron.schedule` call that invokes it and a job pointing at a missing function fails every ten minutes. It is `security invoker`: pg_cron runs it as the table owner, which bypasses RLS without needing elevation. (F02)

## Feature Log

<!-- Newest phase first. Entry format — repeat per completed feature:

### Phase {{N}} — {{PHASE_NAME}}

#### Feature {{NN}} — {{FEATURE_NAME}}  *(YYYY-MM-DD)*
- Decision: …
- Gotcha: …
- Verified: …

At that phase's checkpoint, the whole phase collapses to:

### Phase {{N}} — {{PHASE_NAME}} *(compacted)*
- {{SUMMARY_BULLET}} (F{{NN}}–F{{NN}})

-->

### Phase 1 — Core chat

#### Feature 09 — Message rendering  *(2026-08-01)*

- Decision: **highlighting runs in the browser, because it cannot run anywhere else.** `library-docs.md` said "on the server where possible" and `architecture.md` named the shiki highlighter as its example of a warm-process cache; both were written before the thread existed and both were wrong. `Chat` is a Client Component holding `useChat` state, so a streaming message has no server render, and after `router.refresh()` even persisted messages come from client state — a server-side highlight would apply to nothing that stays on screen. Both docs corrected in place.
- What makes the browser affordable: shiki's **JavaScript RegExp engine** instead of Oniguruma (~1 MB of WASM avoided), and dynamic imports for `shiki/core`, the engine, the language index, and every grammar. Confirmed on the network panel — zero shiki requests until a code fence appeared, then exactly the grammars used and each fetched once.
- Decision: **the allowlist is a compatibility guarantee, not a size one.** Lazy loading already handles size. The JS engine cannot emulate every Oniguruma pattern and shiki's `forgiving` flag would silently drop the patterns it fails to parse, so the twelve languages are exactly the set `tests/lib/highlighter.test.ts` loads and tokenises for real.
- Gotcha: **`bash` is an alias, not a canonical shiki id** — `bash`, `sh`, `shell` and `zsh` all resolve to `shellscript`. The alias table was going to be written from memory and was instead read out of shiki's own `bundledLanguagesInfo`; a test now compares the two, so a version bump that moves an alias fails loudly instead of quietly rendering ```py as plain text.
- Gotcha: **intercept a fence at `pre`, never at `code`.** Branching on `className` — the shape `library-docs.md` itself carried — only sees a fence that named its language; a bare ``` fence has no class and falls to the inline branch, rendering as inline code mid-paragraph. Reading the hast node catches both, and replacing `pre` avoids nesting the code block's `<div>` inside a `<pre>`.
- Decision: **highlighting waits until a message settles.** Re-tokenising a growing string is quadratic over a stream, and a half-written fence tokenises as whatever it currently looks like. Measured: the stream ended at 10,642 ms and the first token span appeared at 10,877 ms, with **zero** frames where highlighting and streaming overlapped.
- Decision: **markdown for the assistant only.** A user message stays literal, because rendering it would silently reformat the person's own words and break the match between what is on screen and what the model was sent.
- Decision: **the fifteen non-behavioural elements are styled by `.markdown-body` in `globals.css`**, not by a `components` map. `@tailwindcss/typography` ships a competing type scale and grey ramp and is deliberately absent.
- Decision: **the syntax theme uses only DESIGN.md's neutrals** — ink for keywords, body-strong default, body for values, mute for comments and punctuation. A first draft borrowed `success`/`danger` for diff lines and was cut: those are state colours, and a diff line is not state.
- Gotcha: **an error boundary without a reset is worse than it looks.** `componentDidUpdate` clearing the failure on a content change is what lets a message recover — verified by disabling it and re-running the same probe: with the reset, one frame in fallback at 134 characters and six rendered frames after; without it, seven fallback frames from 154 to 841 characters and a message that ended permanently as raw text. Every earlier message stayed rendered in both runs.
- Verified: typecheck, lint, build, and 79 tests green, the highlighter suite falsified three ways (alias removed, `structure: 'classic'`, a language dropped from the allowlist) before being trusted. In the browser against real Gemini: GFM structure complete (h2, nested lists, blockquote, table with header cells, bold, inline code, and a link carrying `target="_blank" rel="noopener noreferrer"`); **`<img src=x onerror="…">` in the model's answer produced 0 `img`, 0 `script`, and 0 `[onerror]` elements and survives as literal text** — the raw-HTML boundary holds; fence labels `ts`, `py`, `mermaid`, `bash` and `text` all shown verbatim, with the unsupported and unlabelled ones rendering plain rather than throwing; both copy buttons read back off the clipboard, the message one returning raw markdown with its fences, pipes and list markers intact; the meta line at opacity 0 at rest, 1 on hover and 1 on keyboard focus. At 360px with `pointer: coarse` the meta line is persistently visible, the copy button is 44px tall, an eight-column table and a 170-character shell command each scroll inside their own container, and **the page never scrolls sideways**. After a reload the thread renders identically — 3 code blocks, 18 token spans, same structure — and all four assistant rows carry `model_id = gemini-3.6-flash` with real token counts. Test conversations deleted; both tables back to zero rows.

#### Feature 08 — Streaming responses on the shared key  *(2026-08-01)*

- **`SHARED_MODEL_ID` had to change: Google 404s `gemini-2.5-flash` with "no longer available to new users"** — while still listing it from the models endpoint, so the catalog cannot be trusted as proof a model works. Replaced with `gemini-3.6-flash`, verified by a real `generateContent` call. Pinned rather than the `gemini-flash-latest` alias, which also works: this key is billed and F17 derives `estimated_usd` from a Flash rate card, so an alias that quietly moves to differently-priced weights makes that ledger wrong with nothing on screen to say so.
- **`onAbort` gives you `steps` and nothing else, and a single-step generation stopped mid-flight has none.** Stopping with 1,250 characters on screen persisted an empty row — the invariant that an aborted stream keeps whatever arrived was silently broken. Fixed by accumulating deltas in `onChunk` (`chunk.type === 'text-delta'`, `chunk.text`) and writing that accumulator from both `onAbort` and `onError`. Re-measured: 369 characters on screen, 369 persisted, still there after a reload.
- Decision: **the new conversation's id travels back as a transient data part**, caught by `useChat`'s `onData`, with `router.replace` correcting the URL once the response finishes. The server keeps id authority and F07's flat 404 for an id that is not yours survives — a client-minted id would have forced that 404 to become "create it".
- Decision: **one `Chat` client component for both `/chat` and `/chat/[id]`.** They differ only in whether `conversationId` is null; splitting them would mean two streaming paths to keep in step. `use-send-message.ts` was deleted outright — `useChat` replaces it.
- Decision: **`status` and `error_message` ride along as message metadata.** Mapping a row to a bare `UIMessage` drops them, so a failed answer would show its error state until the page reloaded and then come back looking ordinary.
- v7 corrections found by reading the installed `.d.ts` rather than the docs, both now fixed in `architecture.md` and `library-docs.md`: **`onFinish` is a deprecated alias for `onEnd`**, and the route example **passed stale history** — loading messages, appending the user row, then handing the model everything except the message being answered. Silent, because the model still replies, just to the wrong thing.
- Gotcha: **Turbopack did not hot-reload the route handler.** Two rounds of "the fix does not work" were a stale module — zero diagnostic output from code that was definitely on disk. Restarting `pnpm dev` made the same code work first time. Restart the dev server before believing a server-side change had no effect.
- Gotcha: Gemini 3.x spends its first seconds on reasoning tokens, so a stop pressed early catches nothing to save. Test the abort path by waiting for visible answer text, not for the stop button to appear.
- Verified: 58 tests green, the shared-model guard falsified before being trusted. In the browser, against real Gemini: **14 DOM updates across 11 distinct lengths over 13.4 seconds**, which is what proves it streams rather than arriving in one block; the URL correcting from `/chat` to `/chat/<id>` and the sidebar picking it up; a follow-up message with no navigation; stop ending generation with the partial answer persisted and re-rendered with `message-error` styling (`#d8735e` border on `#383330`) after a reload; assistant rows moving `streaming → complete` with real token counts and `used_shared_key = true`. The error path was verified for free by the model 404 before the id was fixed — it rendered inline without blanking the thread.

#### Feature 07 — New conversation and composer  *(2026-08-01)*

- Decision: **`POST /api/chat` owns conversation creation**, with `conversationId` nullable. A separate `/api/conversations` would have been tidier to read, but it puts creation on the far side of the refusal path — every quota wall at F16 and every tripped breaker at F17 would strand an empty "New chat" in the sidebar. One handler owning both is what keeps "a refusal leaves no trace" true. `architecture.md` and `library-docs.md` both carried the non-nullable shape and were corrected in place.
- Decision: **the request body is already F08's shape** — a singular `message` with `id`/`role`/`parts`. Slightly ceremonial to construct by hand at a feature with no `useChat`, and worth it: F08's `prepareSendMessagesRequest` produces exactly this, so the transport arrives without the schema moving.
- Decision: **the route carries an explicit marker where F08 inserts `resolveModel()` and the quota reservation** — above every write, no exceptions. The ordering invariant is easy to violate by accident and invisible in review once violated.
- Decision: **no `ui/textarea` primitive.** The plan called for one, but the composer's textarea is transparent and borderless inside a bordered wrapper, so every generated style would have been overridden. F23 and F24 need a standalone bordered textarea; whichever lands first can add it.
- Gotcha: **`touchConversation()` is load-bearing, not bookkeeping.** There is no trigger on `conversations.updated_at`, and F06's sidebar orders on it. Without an explicit update every conversation keeps its creation time and the list silently stops reflecting activity. Proven by watching the older of two conversations climb to the top after receiving a message.
- Gotcha: **`router.refresh()` after every send.** Next preserves a layout across navigation and F06 put the conversation query in the layout, so without it a new conversation never appears in the sidebar and an existing one never moves. Proven by watching the sidebar go 0 → 1 rows with no reload.
- Gotcha: PostgREST cannot span a transaction, so a conversation can outlive the message that justified it. The handler deletes the conversation it just created if the message insert throws.
- Gotcha: **`getByLabel('Message')` also matches the send button** — Playwright's label matching is substring by default, and `aria-label="Send message"` contains it. `getByRole('textbox', …)` disambiguates.
- Verified: typecheck, lint, build, and 49 tests green, the four new `textOf` cases falsified by deleting the part filter and confirming exactly that test went red. In the browser: send disabled when empty and enabled with text; redirect to `/chat/<uuid>`; the message rendered and the box cleared; the sidebar populating with no reload, under Today, titled "New chat", timed "now"; a second conversation created and the older one climbing back to the top on its next message; Shift+Enter inserting a newline without sending; the textarea growing to 64px for two lines and capping at 320px — exactly 40% of an 800px viewport — then scrolling; Enter sending. Refusals: someone else's conversation 404s, a non-existent id 404s, a whitespace-only message and a malformed body both 400 with `invalid_input` and no zod detail. All four wrote nothing, and the `null`-conversationId 400 created no orphan, which is what proves validation sits above creation. Typing at `/chat` and navigating away left the table untouched. Fixtures, the throwaway second user, and its conversation all deleted.
- **F06's open gap is closed.** `/chat/[id]` exists, so the active indicator could finally be exercised: `aria-current="page"`, `canvas-soft` fill, `ink` text, and a 2px `#f7f5f0` bar at `left: 0`.
- Gotcha worth repeating from F06: **two "bugs" during this pass were premature reads, not defects.** Enter-to-send looked broken because the thread and composer were sampled before `router.refresh()` had finished its server round-trip on a cold Turbopack route; the database already held every message, in order. Assert on a condition, never on a fixed `waitForTimeout`. The residual truth underneath it is real though — a refresh-driven thread lags by a server round-trip, which is exactly what F08's `useChat` replaces with an optimistic client-side list.
- Note: a sign-in failed once with `bad_oauth_state` and then `PGRST303 'JWT issued at future'`. Transient clock skew between GoTrue and PostgREST at the instant the token was minted — measured 2s apart afterwards, and a reload fixed it. Not a code fault; worth recognising rather than debugging again.

#### Feature 06 — Conversation list  *(2026-08-01)*

- Decision: **day groups are UTC calendar days.** Consistent with how `shared_key_usage.usage_date` already defines a day, deterministic, and needs no timezone cookie. The accepted cost is that a user several hours from UTC can see a conversation from late tonight filed under "Previous 7 days"; the row's own relative time still reads "12 hours ago", so only the heading is off, and only near midnight. Pinned in `tests/lib/conversations.test.ts` as an assertion rather than left as folklore.
- Decision: **the layout starts the query and hands the sidebar an unawaited promise.** The first draft had `ConversationList` calling `listConversations()` itself, which the `import/no-restricted-paths` rule rejected immediately — nothing under `src/components/` may import from `src/server/`. Awaiting it in `(app)/layout.tsx` instead would have blocked the whole three-column frame on a database round trip and made the skeleton dead code. Passing the pending promise keeps the fetch in `src/app/`, starts it before the profile fetch resolves, and lets the sidebar await it inside a `Suspense` boundary. The invariant turned out to improve the design rather than merely constrain it.
- Decision: **`ConversationRow` is the only part of the list that ships to the browser.** A layout cannot read a child segment's `params`, so the URL is the sole source for which conversation is open; `usePathname()` in a leaf is the smallest thing that answers it. The query, the grouping, and the time formatting all stay on the server and arrive as props.
- Decision: **`listConversations()` selects four columns, not `*`.** No CDN sits in front of the origin, and `system_prompt` can be 10,000 characters the sidebar has no use for. Archived rows are filtered outright rather than behind a flag — F22 is where "show archived" is specified and can add the parameter then.
- Gotcha: **no element in the list may carry an `id`.** Below 1024px the desktop `<aside>` is `display:none` but still in the document while the drawer copy is mounted, so every id would exist twice. Group headings are `<h2>` with `<ul aria-label>`, never `aria-labelledby`.
- Gotcha: at exactly seven days `formatRelativeTime` crosses into weeks and reads "last week", not "7 days ago" — noticed when an ad-hoc expectation against the real fixtures disagreed with the code. The code was right.
- Verified: `pnpm typecheck`, `pnpm lint`, `pnpm build`, and `pnpm test` (45 tests, 13 new) all green. The grouping suite was itself falsified before being trusted — `RECENT_DAY_LIMIT` widened to 8 and the pinned branch short-circuited, which turned exactly the three expected tests red, then reverted. Six fixtures spanning every group were seeded through the Supabase MCP, the query's ordering and archived exclusion confirmed against them in SQL, the real rows run through `groupConversations` to confirm they land in the expected headings, and the fixtures then deleted (`conversations` is back to zero rows).
- Verified in a browser with the `playwright-cli` skill, against the same six fixtures, after a first pass had wrongly written the whole visual surface off as unverified: four headings in order with the archived row absent; the long title truncating at 616px of content inside a 153px box, `text-overflow: ellipsis`, `white-space: nowrap`, exactly one line; the relative time at `opacity: 0` at rest and `1` on hover **with the title's width unchanged at 153px**, which is the jump the fixed slot exists to prevent; the focus ring at 1px `#f7f5f0` offset 2px, with the time revealed on `:focus-visible`; the sidebar at exactly 260px at 1920/1440/1024 and replaced by the drawer trigger at 768/360; and under `--mobile` emulation (`pointer: coarse`, `hover: none`) the time persistently visible with no hover at all, on 44px rows.
- The duplicate-DOM reasoning was confirmed rather than assumed. With the drawer open at 360px the page holds **two** `nav[aria-label="Conversations"]`, only one visible, **ten** conversation rows, and **zero** elements carrying an `id` anywhere inside either list.
- Gotcha: an opacity read taken in the same tick as a keypress returns the *start* of the 150ms transition rather than its end, which briefly looked like keyboard focus failing to reveal the time. It reads 1 once settled, and the rule — `.group-focus-visible\:opacity-100:is(:where(.group):focus-visible *)` — was confirmed present by walking the stylesheet recursively. A flat pass over `document.styleSheets[].cssRules` finds nothing, because Tailwind v4 nests every utility inside `@layer`.
- The active indicator could not be exercised here at all: `/chat/[id]` had no route until F07, so every row linked to the root 404, which renders *outside* the `(app)` layout with no sidebar. **Closed by F07**, which confirmed `aria-current="page"`, the `canvas-soft` fill, and the 2px `primary` left bar.

### Phase 0 — Foundation *(compacted)*

Five features, all on 2026-07-31. Versions landed: Next 16.2.12, React 19.2.4,
Tailwind v4.3.3, TypeScript 5.9.3, zod 4.4.3, Vitest 4.1.10, `@supabase/ssr`
0.12.4, `@supabase/supabase-js` 2.111.0, pnpm 11.18.0 on Node 26.5.0. Supabase
project `promptx` / `kplbxqujihxzdltrwxbw`, `ap-southeast-1`, Postgres 17.6,
five recorded migrations. Everything still binding from this phase is filed
under Standing Constraints above.

- **Scaffold and design tokens (F01).** The whole `DESIGN.md` `@theme` block, three `next/font` faces, five shadcn primitives retuned in place, Prettier + ESLint flat config, and the boundary invariants turned into lint rules while the tree was still empty. Four silent failures were found and closed here, every one of which compiled, linted and typechecked cleanly: the font tokens not reaching `next/font`, the spacing tokens shadowing Tailwind's container scale (`max-w-4xl` = 64px), `cn()` dropping custom type steps, and `server-only` throwing under Vitest. A doc claim was corrected too — a cleared breakpoint emits *nothing* rather than failing to compile, so the protection is real but the failure mode is silence.
- **Schema and scheduled jobs (F02).** Eight tables, three enums, the generated `search_vector` and its GIN index, the `handle_new_user` trigger, and both `pg_cron` jobs — verified as actually *running* in `cron.job_run_details`, not merely scheduled. Hosted-only was chosen deliberately (no Docker on this machine), trading away `supabase db reset` and with it any proof that a migration replays from zero. RLS was enabled here rather than in F03 so no table sat world-readable in between.
- **RLS policies (F03).** 27 owner policies across seven tables, the two `anon` share policies pulled forward from F33, a private `attachments` bucket, and a 16-test isolation suite. The suite was itself tested by weakening a policy to `using (true)` and confirming exactly two tests went red — a suite that has never failed is indistinguishable from one that asserts nothing.
- **Google Sign-In (F04).** The full loop against a real Google account, the real landing page, `src/proxy.ts`, and `tests/auth/auth-config.test.ts` pinning four dashboard settings that have no diff and no history. F03's closing instruction to disable signups was found to be wrong on both counts and corrected in place rather than quietly dropped. The open-redirect guard moved to a unit-tested `safeRedirectPath()`, which immediately surfaced a second bypass (`/\evil.example`) the inline version had missed.
- **Application shell (F05).** The three-column frame, an edge-anchored `Sheet` for the mobile drawer and outline sheet, the account menu, the first `error.tsx`/`loading.tsx`/`not-found.tsx` in the repo, and `src/server/data/profiles.ts` — the first module in that folder, a feature earlier than planned, because the `.from()` lint rule is exempted there and nowhere else. Collapse state moved from the plan's `localStorage` to a cookie so the Server Component paints the collapsed state directly. An exit animation was found to strand the panel on screen after Escape and was removed; `UserAvatar` was switched off lazy loading. The mobile layout, carried as *Not verified* by both F01 and F04 because the browser window would not resize, was finally verified at 360/767/768/1023/1024/1920 by loading the app in a sized same-origin iframe — media queries evaluate against the iframe's own viewport, which sidesteps the resize problem entirely. Worth reusing at F37.

**Open at the close of Phase 0.**

- **`auth_leaked_password_protection` is disabled** — a new WARN from `get_advisors security` that F03 did not see. Low impact here, since no real user ever sets a password (Google OAuth only; the email provider exists solely so F03's suite can `signInWithPassword` against admin-created users). Enabling it is a dashboard change and was left alone rather than made silently. Worth deciding at F38.
- **`prompts_tags_idx` is still an unused index.** Correct — nothing queries it until F24.
- **No migration has been proven to replay from an empty database.** Unchanged since F02, and it stays true until a local stack exists.
