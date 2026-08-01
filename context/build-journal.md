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
- **A write that RLS filters out looks exactly like a successful no-op, so a mutation that needs to report "nothing matched" must return a row count.** `deleteConversation()` and `setGeneratedTitle()` both `.select()` after the write and return a boolean; the route turns false into 404. One round trip where a read-then-write precheck would be two, and the condition stays inside the statement so the database decides once. (F10, F11)
- **`listConversations()` selects four columns, not `*`.** No CDN sits in front of the origin, and `system_prompt` can be 10,000 characters the sidebar has no use for. (F06)
- **The `attachments` bucket is private and stays private.** Storage paths must begin with the owner's user id, because the object policies match on the first path segment and nothing else — a path built any other way is unreachable by its own owner. (F03)

### Shell and layout

- **Shell layout state is a cookie, never `localStorage`.** `(app)/layout.tsx` is a Server Component, so it can read a cookie during render and emit the collapsed markup in the first byte. `localStorage` is unreadable until after hydration, which would paint the sidebar expanded and snap it shut on every navigation — for exactly the people who chose to close it. Read with `await cookies()`, written with one line of `document.cookie`; no route handler, because the server only reads it back. Names and values are in `src/lib/constants.ts`. (F05)
- **Sheet motion is entry-only. Never add a closing animation.** Radix defers unmounting a closing element to an `animationend` whenever the computed `animation-name` changes on close. When that event does not arrive, the overlay unmounts while the panel stays on top of the page, visible and interactive — observed directly, with Escape leaving the sidebar stranded at `data-state="closed"` and no animation running. With no exit keyframe the name stays `none` and Radix unmounts at once. A CSS transition is not a substitute: Radix listens for `animationend`, never `transitionend`. (F05)
- **The sidebar and rail reach `AppShell` as rendered Server Component nodes, not as imported components.** That is what keeps their markup in the RSC payload instead of the client bundle, which matters because no CDN sits in front of the origin. The consequence to remember: they cannot receive callbacks, so the collapse toggles read state through React context instead. (F05)
- **The mobile drawer traps focus into the sidebar, and it lands on the first row's overflow trigger.** Measured: with the drawer open, `document.activeElement` is `BUTTON[Options for …]` and the first `<li>` matches `:focus-within` with no user action at all. Any `group-focus-within:` rule on a sidebar row therefore fires for free whenever the drawer opens — which is how F11's timestamp ended up hidden on touch. Worth re-checking at F37 whether the trigger is the right thing to receive that focus. (F11)
- **A sidebar row is `<li class="group">` with the link as a sibling of the overflow trigger**, because a button cannot live inside an anchor. Two consequences: `group-focus-visible` does not work once focus can land on a descendant (use `group-focus-within`), and the link needs `after:absolute after:inset-0` to keep the whole row clickable, with the trigger lifted above it by `relative z-10`. (F11)
- **The timestamp and the overflow trigger share one grid cell**, swapping rather than each taking a slot, so the title's truncation point never moves. On a coarse pointer the container becomes a flex row and both show — grid placement is inert on a flex item, so the same two children serve both modes. The timestamp carries `pointer-events-none`: inline text paints above a non-positioned sibling's box, so it otherwise wins the hit test and swallows clicks meant for the trigger. (F11)
- **No element in the sidebar list may carry a hand-written `id`.** Below 1024px the desktop `<aside>` is `display:none` but still in the document while the drawer copy is mounted, so every id would exist twice. Group headings use `<ul aria-label>`, never `aria-labelledby`. Radix's generated ids are safe — `useId` derives from tree position, and the two copies were measured producing different values with zero duplicates document-wide. (F06, confirmed F11)
- **The layout starts the conversation query and hands the sidebar an unawaited promise.** Nothing under `src/components/` may import from `src/server/`, and awaiting in the layout would block the whole frame on a database round trip and make the skeleton dead code. The sidebar awaits it inside `Suspense`. (F06)
- **Sidebar day groups are UTC calendar days**, consistent with `shared_key_usage.usage_date` and needing no timezone cookie. Accepted cost: near midnight a user far from UTC sees a heading that disagrees with the row's own relative time. (F06)
- **A collapsed column leaves a 36px gutter strip holding its restore button.** Not in `DESIGN.md`, which says only that the columns collapse. A fully hidden column has no way back, and a floating restore button would overlap the thread once F09 fills it. (F05)
- **The 404 lives at `app/not-found.tsx`, at the root, and cannot be moved inside the shell.** Next resolves a path matching no route against the root not-found; a `(app)/not-found.tsx` fires only for an explicit `notFound()` inside a route that already exists. Anything else would mean a catch-all route existing purely to fake it. (F05)

### Testing

- **There is no local Supabase stack.** Migrations are authored as files under `supabase/migrations/` — still the source of truth — and delivered to the hosted project through the Supabase MCP. Consequences that bind everything downstream: no `supabase db reset`, so no migration is ever proven replayable from zero; types come from MCP `generate_typescript_types`, not `gen types --local`; and F03's RLS suite runs against the cloud instance. (F02)
- **`playwright-cli open` is headless unless given `--headed`.** The tell is inside the page: `screen.width` reads exactly 1280×720 headless and the real display size otherwise. F10 lost several minutes hunting for a window that was never drawn, and asked the user to find it too. The binary is also called "Google Chrome for Testing", not "Chromium", which is what someone scanning their dock is looking for. A second gotcha found at F11: two sessions cannot share one `--profile` directory, because Chromium locks it — close the first before opening the second. (F10, extended F11)
- **The browser tool is the `playwright-cli` skill.** The Playwright MCP server was removed and replaced by it; `CLAUDE.md` and `library-docs.md` pointed at the dead MCP for a while, which is how F06 came to record its whole visual pass as *Not verified* — the extension was not connected, the MCP was gone, and the skill that was available the entire time went unchecked. Check the skill list before concluding a browser is out of reach. It is a debugging tool only: `@playwright/test`, `playwright.config.ts`, and `e2e/` still arrive at F36. Sign-in is Google OAuth, so open with `--persistent --profile` or `state-load` a saved session. (F06)
- **Component behaviour has no automated coverage, and will not until F36.** `vitest.config.ts` matches `tests/**/*.test.ts` only — no `.tsx`, no jsdom, no React Testing Library — and Playwright arrives at F36. Anything UI-shaped is verified in a browser and recorded as such; the testable residue is pure helpers, which is why F05 extracted `resolveDisplayName()` and `initialOf()` into `src/lib/utils.ts` rather than inlining them. Do not report a UI feature as "tested" on the strength of `pnpm test`. (F05)
- **Unit tests live in `tests/`, and `server-only` is aliased to an empty stub under Vitest** — otherwise every `src/server/` module throws at import time, before a single assertion runs, for a reason unrelated to what is being tested. The stub must stay empty; the real guard still does its job at build time. (F01)
- **Data and policy tests run against the hosted project and own their fixtures.** There is no local stack and no `seed.sql`. The pattern, established in `tests/rls/isolation.test.ts` and to be reused by every later data test: `auth.admin.createUser({ email_confirm: true })` on the service-role client with a `crypto.randomUUID()` email, then `signInWithPassword` on a publishable-key client to get a real JWT, then assertions through that client. `afterAll` deletes the users and the cascade clears the rest. (F03)
- **Seed fixtures with the service-role client, never through the policies under test.** If seeding goes through a policy that is broken, the table ends up empty and every "cannot see the other user's row" assertion passes for entirely the wrong reason. (F03)
- **Delete storage objects before deleting an auth user.** Supabase refuses to delete a user who still owns objects, and reports it as a generic delete failure that looks nothing like the cause. (F03)
- **Vitest ships in Phase 0, Playwright at F36.** F03's RLS suite needs the former; nothing needs browser binaries until there is a spec to run. (F01)
- **Turbopack does not reliably hot-reload a route handler.** Two rounds of "the fix does not work" at F08 were a stale module, with zero diagnostic output from code that was definitely on disk. Restart `pnpm dev` before believing a server-side change had no effect. (F08)
- **Assert on a condition, never on a fixed `waitForTimeout`.** Two "bugs" at F07 were premature reads taken before a `router.refresh()` round trip completed; the database already held every row, in order. Relatedly, an opacity read in the same tick as a keypress returns the *start* of a 150ms transition. (F06, F07)
- **Driving Radix from the console does not work.** A programmatic `element.click()` will not open a menu — the trigger listens on `pointerdown`. Use a real click, and disambiguate the duplicated sidebar with Playwright's `:visible`. (F11)
- **`PGRST303 'JWT issued at future'` on the first load after sign-in is clock skew, not a code fault.** Transient disagreement between GoTrue and PostgREST at the moment the token is minted; a reload clears it. Seen at F07 and again at F10. (F07)
- **A test suite that has never failed proves nothing.** The RLS suite was verified by weakening a policy to `using (true)`, confirming exactly the two expected tests went red, and restoring it. Any future change to these policies should be checked the same way. (F03)

### Quota and limits

- **The two quota limits are `NEXT_PUBLIC_*`, and the prefix is load-bearing.** Next inlines only that prefix into client bundles, and the composer displays the daily cap — unprefixed, the UI would fall back to its default while the server enforced the configured number, and the two would disagree silently with nothing to indicate it. Neither value is a secret. The cost is that both are inlined at build time, so changing either on Render needs a rebuild rather than a restart. (F01)
- **`reconcile_shared_key_usage()` shipped early, in F02 rather than F17**, because F02 registers the `cron.schedule` call that invokes it and a job pointing at a missing function fails every ten minutes. It is `security invoker`: pg_cron runs it as the table owner, which bypasses RLS without needing elevation. (F02)
- **Title generation reaches the shared key through `sharedTitleModel()`, never `resolveModel()`.** `resolveModel()` is where F16 inserts `reserveSharedSlot()`, so a shared path would silently start charging every user a daily message for a title they never asked for. `sharedTitleModel()` takes no user id, so there is nobody to charge; a test pins its arity at zero. (F10)
- **Titling spend is unmeasured until F17 wires it deliberately, and the sweep cannot cover for it.** `reconcile_shared_key_usage()` derives usage from `messages` rows carrying `used_shared_key`, and a title writes no message row, so those tokens are invisible to it by construction. (F10)

### Chat and streaming

- **`POST /api/chat` owns conversation creation; `conversationId` is nullable and null means "create one".** A separate endpoint would put creation on the far side of the refusal path, so every F16 quota wall and F17 tripped breaker would strand an empty "New chat" in the sidebar. One handler owning both is what keeps "a refusal leaves no trace" true. (F07)
- **Nothing is persisted until the request is certain to reach a provider**, and the route carries an explicit marker where that line sits. The ordering is easy to violate by accident and invisible in review once violated. (F07)
- **AI SDK v7, read off the installed `.d.ts` rather than the docs.** `onFinish` is a deprecated alias for `onEnd`. `onAbort` receives only `steps`, and a single-step generation stopped mid-flight has none — a partial answer must be accumulated in `onChunk` and written from both `onAbort` and `onError`. Compose the abort signal with `request.signal`, or the stop button hides a response the provider keeps billing for. (F08)
- **`touchConversation()` is load-bearing, not bookkeeping.** There is no trigger on `conversations.updated_at` and the sidebar orders on it; skip it and the list silently stops reflecting activity. (F07)
- **`router.refresh()` is what reflects a mutation, not `revalidatePath()`.** The sidebar query lives in the `(app)` layout, which Next preserves across navigation. Every route here reads cookies and is therefore dynamic, so there is no Full Route Cache entry to invalidate — tested at F11 with a controlled A/B on back-navigation, with and without, behaving identically. (F07, confirmed F11)
- **PostgREST cannot span a transaction.** A conversation can outlive the message that justified it, so the chat handler deletes a conversation it just created if the message insert throws. (F07)
- **`SHARED_MODEL_ID` is pinned to a version, never an alias.** Google 404s `gemini-2.5-flash` for new users while still listing it from the models endpoint, so the catalog is not proof a model works — verify with a real call. The key is billed and F17 derives `estimated_usd` from a Flash rate card, so an alias that moves to differently-priced weights makes that ledger wrong silently. (F08)
- **A conversation is auto-titled only while its title is still `'New chat'`, and the gate sits above the provider call.** A repeat request therefore costs one indexed read and no money, and F21's manual rename is protected without a column to record it. (F10)

### Message rendering

- **Syntax highlighting runs in the browser and cannot run anywhere else.** The thread lives inside `Chat`, a Client Component holding `useChat` state, so a streaming message has no server render and after `router.refresh()` even persisted messages come from client state. What makes it affordable: shiki's JavaScript RegExp engine instead of ~1 MB of Oniguruma WASM, plus dynamic imports throughout. (F09)
- **The twelve-language allowlist is a *compatibility* guarantee, not a size one** — lazy loading already handles size. The JS engine cannot emulate every Oniguruma pattern and `forgiving` would swallow exactly that failure, so extending the list means extending the test that loads each grammar for real. Use shiki's canonical ids: `bash`/`sh`/`shell`/`zsh` are all aliases of `shellscript`. (F09)
- **Intercept a fence at `pre`, never at `code`.** Branching on `className` only sees a fence that named its language; a bare fence has no class, falls to the inline branch, and renders as inline code mid-paragraph. (F09)
- **Highlighting waits until a message settles.** Re-tokenising a growing string is quadratic over a stream, and a half-written fence tokenises as whatever it currently looks like. (F09)
- **Markdown renders for the assistant only.** Rendering a user message would silently reformat the person's own words and break the match between what is on screen and what the model was sent. Raw HTML stays off — model output is untrusted input. (F09)
- **A streaming error boundary must reset on content change.** Without it one bad fragment ends the message permanently as raw text; with it, the message recovers on the next delta. Measured both ways. (F09)

### Design system

- **`cn()` must declare every custom token scale.** `tailwind-merge` knows only Tailwind's default class groups, so it dropped `text-button-md` when composed with `text-on-primary` and failed to dedupe `rounded-sm` against `rounded-pill`. `src/lib/utils.ts` uses `extendTailwindMerge`; a token added to `globals.css` and not to that list is silently unreliable. (F01, extended F05)

- **Never use a named width utility.** The `DESIGN.md` spacing tokens shadow Tailwind's container scale, so `max-w-md` is 10px and `max-w-xs` is 4px — the shadowing is silent, with no error and just a collapsed element. Widths are numeric on the 4px grid (`max-w-112` = 448px), enforced by an ESLint rule. (F01, extended F05)

- **The `@theme` font tokens reference the `next/font` CSS variables, never the family names.** `next/font` emits two families per face — the real one and a metric-matched fallback with an ascent/descent override — and only the CSS variable names both, in order. Writing the literal `Inter` still finds the self-hosted face but skips the fallback and drops to `system-ui` while the webfont loads, which is the exact layout shift `next/font` exists to prevent. (F01)

- **shadcn primitives are retuned in place, with no alias layer.** `globals.css` carries only the PromptX `@theme`; the CLI's `:root`/`.dark`/`@theme inline` layer was deleted wholesale and each primitive hand-edited. One vocabulary, and a freshly added component looks visibly wrong until it is retuned — which is the intended forcing function, not an inconvenience to work around. (F01)

- **A destructive confirmation is an `AlertDialog`, not a `Dialog`.** It carries `role="alertdialog"`, drops outside-click dismissal, and focuses Cancel rather than the button that destroys something. Its surface is a deliberate copy of `dialog.tsx` — two confirmation shapes that looked different would read as two systems. F13, F19, and F24 all reuse it. (F11)

- **Hide with `pointer-fine`; never rely on `pointer-coarse` to reveal something a hover rule hides.** Tailwind emits `group-focus-within:opacity-0` *after* `pointer-coarse:opacity-100` and both are single-class specificity, so the hiding rule wins. Default to visible and let only a fine pointer hide anything — a variant that fails to match then leaves a control reachable rather than stranded. A pair that both *reveal* (`opacity-0` + `group-hover:opacity-100` + `pointer-coarse:opacity-100`, as `MessageBubble` does) has no conflict and is fine as written. (F11)

### Tooling

- **`corepack` is not assumed to exist.** Node 26 does not ship it, so it cannot be assumed present on Render's build image either, and the failure mode is a build that dies with `pnpm: not found`. `pnpm` is installed via `npm`, and F38's build command reads the version out of `packageManager` to keep the pinning guarantee Corepack would have given. (F01)

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

### Phase 2 — Bring your own key

#### Feature 13 — Key management  *(2026-08-01)*

- Decision: **the probe is a free models-endpoint call per provider, not a generation.** Zero tokens, no model id — which matters because `src/lib/models.ts` does not exist until F14, so a generation probe would have forced a mini-catalog and pulled F14's `instantiate()` forward. OpenAI and Anthropic `GET /v1/models`, Google `GET /v1beta/models?key=`, OpenRouter `GET /api/v1/key` (scoped to the presented key, so it cannot 200 for an unauthenticated request the way a public catalog might). The accepted gap: a models endpoint can answer for a key that cannot generate.
- Decision: **two probe failures, kept apart, both failing closed.** `401`/`403` → `400 invalid_key`. Timeout, 5xx, or network error → `503 probe_unavailable`. Neither writes a row. A single branch would tell someone their correct key is wrong because a provider had a bad minute, and send them off to regenerate a key that was fine. Bounded by its own `KEY_PROBE_TIMEOUT_MS` (10s) rather than `STREAM_TIMEOUT_MS`, which is two minutes and meant for a stream someone is watching arrive.
- Gotcha: **`bytea` is a hex string over PostgREST, and the failure is silent.** The vault deals in Buffers, the columns are `bytea`, and `src/types/database.ts` types all three as `string` — because PostgREST has no binary type in JSON and renders `\x…`. Passing a Buffer to supabase-js does not throw: it serialises to `{"type":"Buffer","data":[…]}`, Postgres stores those bytes, **the write reports success**, and the damage would surface at F14 as a decryption failure against a real user's key. Confirmed by mutation — removing the conversion left the stored ciphertext decoding to `{"type":"Buffer"…`. `architecture.md` and `library-docs.md` both claimed `bytea` meant "no re-encoding round-trip to get wrong"; over PostgREST that is false, and both were corrected.
- Gotcha: **`noUncheckedIndexedAccess` makes `mock.calls[0]` unusable as a tuple.** A `vi.fn()` declared with no parameters types its calls as `[]`, so casting to a 5-tuple is a type error rather than a convenience. Fixed by asserting with `toHaveBeenCalledWith` and capturing the one argument that needed inspecting inside the mock implementation — better than the cast in any case.
- Gotcha: **`/api/health` does not exist yet.** Reaching for it as a dev-server readiness check returns the 404 page. It arrives at F38; use `/` until then.
- Note: **this feature also built `/settings/account`**, which `build-plan.md` assigns to no feature. It is specified in `project-overview.md` as "profile details and sign-out" and built read-only to exactly that. **Editing `display_name` remains unbuilt and unassigned.** The "Sign-in: Google" row is a literal rather than derived from `app_metadata.provider` — accurate for every real user, since Google OAuth is the only sign-in method, but it would silently lie if a second provider were ever added.
- Note: the masked key renders as `••••4f2a`, not DESIGN.md's literal `sk-…4f2a`. Only the last four characters are stored, and printing an `sk-` prefix in front of a Google key — which begins `AIza` — would show the user something untrue about their own credential.
- Verified: 138 tests, typecheck, lint, and a production build green. The bytea round trip proven end to end against the hosted project (seal → write → read → decrypt → compare), then proven *necessary* by mutating `toHex` away. Probe classification proven per branch with `fetch` stubbed, and inverting the status check turned exactly the three expected tests red, including "writes nothing when the provider rejects the key". In a browser at 1280px: a bogus key refused by the real OpenAI endpoint with the message in an `alert`, the dialog staying open for retry, and **zero rows written**; a seeded row rendering as `••••4f2a` + label + date; removal confirming through an `alertdialog` focused on Cancel and resetting the row via `router.refresh()`. No sealed column appeared in the DOM or in the raw server HTML. At 360px with `pointer: coarse` and `hover: none`: every control 44px tall, opacity 1, no horizontal overflow. Test user and fixtures deleted; `promptx.test` users remaining: 0.

#### Feature 12 — The encryption vault  *(2026-08-01)*

- Decision: **the vault reads `serverEnv.ENCRYPTION_KEY` and validates nothing.** `architecture.md` held two invariants that could not both be true — "every secret environment variable is read through `src/server/env.ts` and nowhere else" (line 1389) against "`vault.ts` … the only module that reads `ENCRYPTION_KEY`" (line 1387) — and its canonical snippet resolved the tie the wrong way, re-checking a 32-byte length that `env.ts:22-27` had already proven at boot. Two modules validating one variable is two rules free to drift. `env.ts` won: invariant 1387 was narrowed to describe *use* rather than *read*, and the snippet was rewritten in place.
- Decision: **`decrypt()` throws a typed `DecryptionError` with no `cause`.** node's own failure is `Unsupported state or unable to authenticate data` — opaque, and identical for a tampered row and a rotated master key, so it is replaced rather than wrapped. `cause` is omitted deliberately: it is the field that ends up in a log line by accident, and this module's entire job is that nothing from it ever does. `encrypt()` does not wrap at all — with an already-validated key it has no expected failure mode.
- Gotcha: **the `vi.stubEnv` pattern `library-docs.md` documented cannot work against this design.** `serverEnv` is parsed once at module load, so by the time a test body runs the value is frozen. The suite uses `vi.resetModules()` + dynamic `import()` — the pattern `tests/server/env.test.ts` already established for the same reason. A knock-on: each import mints a *new* `DecryptionError` class, so an `instanceof` assertion only holds against the one from the same load. The helper returns the whole module rather than letting tests import the error separately.
- Gotcha: **the mutation that breaks a test is rarely the one you predict.** The plan said dropping `setAuthTag` would turn the three tamper tests red. It did not — it left all three **green**, because node refuses `final()` on a GCM decipher that was never given a tag, so they threw for an unrelated reason. The *round-trip* tests are what failed. A second mutation (`decrypt()` returning `''` instead of throwing) turned the tamper tests red as intended.
- Gotcha: **that second mutation exposed a test passing by swallowing its own assertion.** `reveals nothing about the key material` called `expect.unreachable()` inside a `try` whose own `catch` then caught it and cheerfully asserted against it — so it stayed green against a `decrypt()` that never threw. Restructured to capture the error in a variable and assert outside the block. Found only because the suite was mutated; typecheck, lint, and a green run all missed it.
- Gotcha: `noUncheckedIndexedAccess` types `buffer[0]` as `number | undefined` and `^=` does not narrow it, so byte-flipping goes through `writeUInt8`/`readUInt8`. Compiles cleanly the moment it stops being index access.
- Verified: 105 tests green (95 prior + 10 new), `pnpm typecheck` and `pnpm lint` clean. `grep console. src/server/vault.ts` empty; line 1 is `import 'server-only'`. IV uniqueness asserted at the full 1,000 encryptions specified in `build-plan.md`, with ciphertext distinctness alongside it — unique IVs alone would not prove the IV reaches the cipher. Both mutations were reverted and the suite re-run green.

### Phase 1 — Core chat *(compacted)*

Six features, all on 2026-08-01. The phase turned an empty three-column shell
into a working chat: a grouped sidebar, a composer, streaming answers on the
shared Gemini key, rendered markdown with highlighted code, auto-generated
titles, and delete. Everything still binding is filed under Standing Constraints
above.

- **Sidebar and composer (F06–F07).** The conversation query starts in the layout and arrives at the sidebar as an unawaited promise — a shape the `no-restricted-paths` lint rule forced and that turned out better than the alternative. `POST /api/chat` was given ownership of conversation creation with a nullable `conversationId`, so that F16's quota wall and F17's breaker cannot strand an empty "New chat"; `architecture.md` and `library-docs.md` both carried the non-nullable shape and were corrected. Two things proved load-bearing rather than cosmetic: `touchConversation()`, because nothing triggers `updated_at`, and `router.refresh()`, because the sidebar query lives in a layout Next preserves across navigation.
- **Streaming (F08).** The first end-to-end path. `SHARED_MODEL_ID` had to move to `gemini-3.6-flash` — Google 404s the 2.5 model for new users while still listing it, so the catalog is not proof. Two v7 corrections came from reading the installed `.d.ts` rather than the docs: `onFinish` is a deprecated alias for `onEnd`, and the documented route example passed the model everything *except* the message being answered. `onAbort` was found to carry no partial text at all, silently breaking the invariant that an aborted stream keeps what arrived.
- **Rendering (F09).** Highlighting moved into the browser, against the advice in two of this project's own docs, because the thread is client state and a server-rendered highlight would apply to nothing that stays on screen. Both docs were corrected in place. The language allowlist was reframed as a compatibility guarantee rather than a size one, and a streaming error boundary was found to be worse than useless without a reset.
- **Titles (F10).** Named from the first exchange on a deliberately separate provider entry point, `sharedTitleModel()`, so that F16's reservation cannot be added to the titling path by accident. Two F17 hooks were marked rather than half-built, with the note that the reconciliation sweep cannot cover for the missing one.
- **Delete (F11).** The sidebar row was restructured so a menu button could sit outside the link, and the timestamp and trigger were made to share one slot so the title's width never moves. Three defects surfaced only in a browser — an invisible timestamp swallowing clicks, a click target silently shrinking to the width of the title, and a timestamp hidden on touch by the drawer's own focus trap. None was visible to the type checker, the linter, or a unit test.
- **A wrong explanation was committed and then corrected at this checkpoint.** F11's touch bug was first written up as hover plus CSS source order. Reading the built stylesheet at the checkpoint contradicted it, and a direct measurement found the real cause: Radix's Sheet moves focus onto the first row's overflow trigger, so `:focus-within` matches a row the moment the drawer opens. The constraint was rewritten and narrowed — a pair that both *reveal* has no conflict, and `MessageBubble`'s version was verified correct as written.

**Open at the close of Phase 1.**

- **Neither list query is bounded.** `listConversations()` and `listByConversation()` both fetch every row RLS allows, with no `.limit()`. `MESSAGE_PAGE_SIZE` (50) has existed in `constants.ts` since F01 and is still referenced nowhere. Harmless at present scale and genuinely wrong at a few thousand conversations or a long thread — and F37 sets a budget against a 200-message conversation, which is the page most likely to breach it. Decide there whether to paginate or to accept it with a number attached.
- **Titling spend is unmeasured.** F10 shipped the hooks marked and F17 owns filling them. The reconciliation sweep cannot cover for it — see Standing Constraints → Quota and limits.
- **The mobile drawer puts focus on the first row's overflow trigger.** Correct per the focus trap, but probably not the control a person opening a conversation list wants focused. It is also what made F11's touch bug possible. Worth revisiting in F37's accessibility pass.
- **Component behaviour still has no automated coverage.** Unchanged since F05 and true until F36: `vitest.config.ts` matches `tests/**/*.test.ts` in a node environment, so every UI claim in this phase rests on a browser session, not a suite. The three defects F11 found — all invisible to typecheck, lint, and unit tests — are the argument for F36 rather than a reason to distrust the phase.
- Carried from Phase 0, unchanged: `auth_leaked_password_protection` is still disabled (decide at F38), `prompts_tags_idx` is still unused (correct until F24), and no migration has been proven to replay from an empty database (true until a local stack exists).

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
