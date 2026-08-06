# Build Journal

> **Role:** The dated record of how the build got here — one entry per completed feature.
> **Append after every completed feature**; **compact at every phase checkpoint.**
> **Do not read this file at session start.** Open it only to reconstruct one specific feature's history; the rules that still bind live in `constraints.md`.

## How this file is maintained

This file grows for the life of the project and is **not** part of the session
read order. Nothing here is required to make a decision — anything that still
constrains future work gets promoted to `constraints.md`, which is the file
consulted during ordinary work. That separation is what keeps the cost of
knowing "what binds" from growing with the length of the build.

- **Append a dated entry after every completed feature**, under the current phase: decisions made, gotchas hit, verification results.
- **Compact at every phase checkpoint, never continuously.** When a phase closes:
  1. **Promote** anything from that phase that still binds into `constraints.md`, filed under its topic.
  2. **Collapse** the phase's per-feature entries into a handful of summary bullets.
  3. **Drop every `Verified:` line** — it has done its job once the next feature passes.
- Only the current phase keeps full per-feature detail. Earlier phases stay compacted, newest first.

Compaction is recoverable: this file is committed, so `git` history holds every
detail ever removed. Compact confidently.

<!-- Newest phase first. Entry format — repeat per completed feature:

## Phase {{N}} — {{PHASE_NAME}}

### Feature {{NN}} — {{FEATURE_NAME}}  *(YYYY-MM-DD)*
- Decision: …
- Gotcha: …
- Verified: …

At that phase's checkpoint, the whole phase collapses to:

## Phase {{N}} — {{PHASE_NAME}} *(compacted)*
- {{SUMMARY_BULLET}} (F{{NN}}–F{{NN}})

-->

## Phase 2 — Bring your own key *(compacted)*

Six features, 2026-08-01 to 2026-08-05. The phase turned a single hardcoded
Gemini path into a multi-provider workspace with other people's credentials in
it: an AES-256-GCM vault, key management, an enforcing model catalog, a picker,
a per-user daily allowance, and a global monthly circuit breaker. It also
introduced the only RLS-bypassing client in the codebase. Everything still
binding is filed in `constraints.md`.

- **The vault (F12).** AES-256-GCM with a fresh 12-byte IV and a verified auth tag, reading its master key through `serverEnv` and validating nothing, because `env.ts` already proved the length at boot. `architecture.md` carried two invariants that could not both hold and a snippet that resolved the tie the wrong way; both were corrected in place. The suite was mutated twice and the second mutation found a test that had been passing by swallowing its own assertion inside its own `catch`.
- **Key management (F13).** Keys are probed before they are kept, with the two failure modes deliberately kept apart and both failing closed. The phase's most dangerous discovery lives here: `bytea` is a hex string over PostgREST, and handing supabase-js a `Buffer` reports **success** while storing `{"type":"Buffer",…}` — corruption that would only surface later, against a real user's credential. Proven by mutation, and the conversion confined to one module. This feature also built `/settings/account`, which no feature in `build-plan.md` owns.
- **The catalog (F14).** `src/lib/models.ts` became an enforcement boundary rather than a list the picker reads, checked in `resolveModel()` and nowhere else, before the key lookup. **Every shipped id was proven by a real generation, not by appearing in a list** — `gemini-2.5-flash` was run as a deliberate control and failed with "no longer available to new users", which is the only thing that makes the passes mean anything. `openai` and `anthropic` ship as empty catalogs because no key existed to prove an id for either. Three claims in the project's own docs turned out to be wrong and were corrected: a Google factory rename that never happened, a two-argument `getDecryptedKey`, and `@ai-sdk/google` being v7 when it is v4.
- **The picker (F15).** What the interface greys out and what the server refuses became one function rather than two spellings, and selection was keyed on `(provider, modelId)` because the same model appears under two providers with different bills. Two things were measured to be nothing: a test that compared a function against itself, and a `key` prop that fixed no bug — the first was rewritten, the second kept with an honest comment, because what depends on it is billing-relevant and fails silently.
- **The daily allowance (F16).** A slot is claimed, never checked, in a single conditional upsert. **The concurrency test `build-plan.md` asked for cannot be written against this project**, and finding that out took a mutation: a deliberately racy read-then-write with a one-second sleep kept the suite green, because requests to the hosted project serialise and no second statement ever lands inside the window. The invariant is held by the implementation's shape — confirmed against the live database with `pg_get_functiondef`, not against the migration file — and the test was kept with an honest name and the measurement in its comment.
- **The circuit breaker (F17).** The second, independent axis, and the first `createServiceRoleClient()`. `estimated_usd` is derived from exact token totals rather than accumulated per call; the availability check is scoped to the current month, because omitting that term is a deadlock reachable by doing nothing. F10's unmeasured titling spend was closed and then *observed* closed: one real message left `message_count = 1` while the ledger held 462 tokens against the message's own 88.
- **A claim written during planning was wrong and the correction is recorded rather than quietly fixed.** F17's rounding argument said a title-sized call rounds to zero in `numeric(10,4)`. Measured in the database before any code was written, it stores as $0.0005 — the real cost is a systematic ~2% downward drift, and the argument that generalises is structural rather than arithmetic. The habit that caught it is the same one this phase relied on throughout: measure the thing rather than reason about it.

**Open at the close of Phase 2.**

- **`openai` and `anthropic` have no models, and no feature owns filling them.** Not a defect — the decision is recorded above — but unassigned work, and visible in the picker as two empty groups. Whoever holds a key for either should list live, prove each id by generating, and add them.
- **Nothing caps `maxOutputTokens`, anywhere.** Providers reserve the model's full ceiling (65,536 on the models tested), which OpenRouter checks against the account balance *before* generating — so a small balance yields a 402 on every request even when actual usage would be trivial. This is why **a successful BYOK generation through the picker has never been demonstrated**; the routing is proven by the failed rows recording the right provider and model. Capping output spans all four providers, so it is a product decision rather than an OpenRouter workaround.
- **A provider's refusal reason never reaches the user.** Every stream failure renders "The model could not finish this response.", so a credit refusal, a rate limit, and a genuine model error are indistinguishable on screen. `code-standards.md` already requires naming the provider without echoing its raw body; the shape exists, the message does not. Decide at F37 with the rest of the error surfaces.
- **Atomicity of `reserve_shared_slot` is unproven by test.** Held by construction and verified structurally against the live function, but no test exercises a real race — the hosted project serialises requests. Two genuinely overlapping sessions need a local stack or F36.
- **The breaker has never tripped from ordinary traffic.** Every trip in testing was seeded, by SQL or by a deliberately oversized token count. The arithmetic is covered and the month-rollover path has now run for real, but nothing has watched spend accumulate to the ceiling over a month.
- **Editing `display_name` is unbuilt and unassigned.** The data model calls the column editable, `/settings/account` renders it read-only, and no feature specifies the path.
- **F17's migration file was edited after `apply_migration` ran**, to correct the rounding claim in its SQL comments. The DDL is byte-identical and the stored `comment on function` text unchanged, so the database matches the file — but the text recorded in `supabase_migrations` is the earlier draft. Harmless, and noted only because replayability is already untested here.
- Carried, unchanged: neither list query is bounded (F06/F08, decide at F37); `auth_leaked_password_protection` is still disabled (decide at F38); component behaviour has no automated coverage until F36; and no migration has been proven to replay from an empty database.

## Phase 1 — Core chat *(compacted)*

Six features, all on 2026-08-01. The phase turned an empty three-column shell
into a working chat: a grouped sidebar, a composer, streaming answers on the
shared Gemini key, rendered markdown with highlighted code, auto-generated
titles, and delete. Everything still binding is filed in `constraints.md`.

- **Sidebar and composer (F06–F07).** The conversation query starts in the layout and arrives at the sidebar as an unawaited promise — a shape the `no-restricted-paths` lint rule forced and that turned out better than the alternative. `POST /api/chat` was given ownership of conversation creation with a nullable `conversationId`, so that F16's quota wall and F17's breaker cannot strand an empty "New chat"; `architecture.md` and `library-docs.md` both carried the non-nullable shape and were corrected. Two things proved load-bearing rather than cosmetic: `touchConversation()`, because nothing triggers `updated_at`, and `router.refresh()`, because the sidebar query lives in a layout Next preserves across navigation.
- **Streaming (F08).** The first end-to-end path. `SHARED_MODEL_ID` had to move to `gemini-3.6-flash` — Google 404s the 2.5 model for new users while still listing it, so the catalog is not proof. Two v7 corrections came from reading the installed `.d.ts` rather than the docs: `onFinish` is a deprecated alias for `onEnd`, and the documented route example passed the model everything *except* the message being answered. `onAbort` was found to carry no partial text at all, silently breaking the invariant that an aborted stream keeps what arrived.
- **Rendering (F09).** Highlighting moved into the browser, against the advice in two of this project's own docs, because the thread is client state and a server-rendered highlight would apply to nothing that stays on screen. Both docs were corrected in place. The language allowlist was reframed as a compatibility guarantee rather than a size one, and a streaming error boundary was found to be worse than useless without a reset.
- **Titles (F10).** Named from the first exchange on a deliberately separate provider entry point, `sharedTitleModel()`, so that F16's reservation cannot be added to the titling path by accident. Two F17 hooks were marked rather than half-built, with the note that the reconciliation sweep cannot cover for the missing one.
- **Delete (F11).** The sidebar row was restructured so a menu button could sit outside the link, and the timestamp and trigger were made to share one slot so the title's width never moves. Three defects surfaced only in a browser — an invisible timestamp swallowing clicks, a click target silently shrinking to the width of the title, and a timestamp hidden on touch by the drawer's own focus trap. None was visible to the type checker, the linter, or a unit test.
- **A wrong explanation was committed and then corrected at this checkpoint.** F11's touch bug was first written up as hover plus CSS source order. Reading the built stylesheet at the checkpoint contradicted it, and a direct measurement found the real cause: Radix's Sheet moves focus onto the first row's overflow trigger, so `:focus-within` matches a row the moment the drawer opens. The constraint was rewritten and narrowed — a pair that both *reveal* has no conflict, and `MessageBubble`'s version was verified correct as written.

**Open at the close of Phase 1.**

- **Neither list query is bounded.** `listConversations()` and `listByConversation()` both fetch every row RLS allows, with no `.limit()`. `MESSAGE_PAGE_SIZE` (50) has existed in `constants.ts` since F01 and is still referenced nowhere. Harmless at present scale and genuinely wrong at a few thousand conversations or a long thread — and F37 sets a budget against a 200-message conversation, which is the page most likely to breach it. Decide there whether to paginate or to accept it with a number attached.
- **Titling spend is unmeasured.** F10 shipped the hooks marked and F17 owns filling them. The reconciliation sweep cannot cover for it — see `constraints.md` → Quota and limits.
- **The mobile drawer puts focus on the first row's overflow trigger.** Correct per the focus trap, but probably not the control a person opening a conversation list wants focused. It is also what made F11's touch bug possible. Worth revisiting in F37's accessibility pass.
- **Component behaviour still has no automated coverage.** Unchanged since F05 and true until F36: `vitest.config.ts` matches `tests/**/*.test.ts` in a node environment, so every UI claim in this phase rests on a browser session, not a suite. The three defects F11 found — all invisible to typecheck, lint, and unit tests — are the argument for F36 rather than a reason to distrust the phase.
- Carried from Phase 0, unchanged: `auth_leaked_password_protection` is still disabled (decide at F38), `prompts_tags_idx` is still unused (correct until F24), and no migration has been proven to replay from an empty database (true until a local stack exists).

## Phase 0 — Foundation *(compacted)*

Five features, all on 2026-07-31. Versions landed: Next 16.2.12, React 19.2.4,
Tailwind v4.3.3, TypeScript 5.9.3, zod 4.4.3, Vitest 4.1.10, `@supabase/ssr`
0.12.4, `@supabase/supabase-js` 2.111.0, pnpm 11.18.0 on Node 26.5.0. Supabase
project `promptx` / `kplbxqujihxzdltrwxbw`, `ap-southeast-1`, Postgres 17.6,
five recorded migrations. Everything still binding from this phase is filed in
`constraints.md`.

- **Scaffold and design tokens (F01).** The whole `DESIGN.md` `@theme` block, three `next/font` faces, five shadcn primitives retuned in place, Prettier + ESLint flat config, and the boundary invariants turned into lint rules while the tree was still empty. Four silent failures were found and closed here, every one of which compiled, linted and typechecked cleanly: the font tokens not reaching `next/font`, the spacing tokens shadowing Tailwind's container scale (`max-w-4xl` = 64px), `cn()` dropping custom type steps, and `server-only` throwing under Vitest. A doc claim was corrected too — a cleared breakpoint emits *nothing* rather than failing to compile, so the protection is real but the failure mode is silence.
- **Schema and scheduled jobs (F02).** Eight tables, three enums, the generated `search_vector` and its GIN index, the `handle_new_user` trigger, and both `pg_cron` jobs — verified as actually *running* in `cron.job_run_details`, not merely scheduled. Hosted-only was chosen deliberately (no Docker on this machine), trading away `supabase db reset` and with it any proof that a migration replays from zero. RLS was enabled here rather than in F03 so no table sat world-readable in between.
- **RLS policies (F03).** 27 owner policies across seven tables, the two `anon` share policies pulled forward from F33, a private `attachments` bucket, and a 16-test isolation suite. The suite was itself tested by weakening a policy to `using (true)` and confirming exactly two tests went red — a suite that has never failed is indistinguishable from one that asserts nothing.
- **Google Sign-In (F04).** The full loop against a real Google account, the real landing page, `src/proxy.ts`, and `tests/auth/auth-config.test.ts` pinning four dashboard settings that have no diff and no history. F03's closing instruction to disable signups was found to be wrong on both counts and corrected in place rather than quietly dropped. The open-redirect guard moved to a unit-tested `safeRedirectPath()`, which immediately surfaced a second bypass (`/\evil.example`) the inline version had missed.
- **Application shell (F05).** The three-column frame, an edge-anchored `Sheet` for the mobile drawer and outline sheet, the account menu, the first `error.tsx`/`loading.tsx`/`not-found.tsx` in the repo, and `src/server/data/profiles.ts` — the first module in that folder, a feature earlier than planned, because the `.from()` lint rule is exempted there and nowhere else. Collapse state moved from the plan's `localStorage` to a cookie so the Server Component paints the collapsed state directly. An exit animation was found to strand the panel on screen after Escape and was removed; `UserAvatar` was switched off lazy loading. The mobile layout, carried as *Not verified* by both F01 and F04 because the browser window would not resize, was finally verified at 360/767/768/1023/1024/1920 by loading the app in a sized same-origin iframe — media queries evaluate against the iframe's own viewport, which sidesteps the resize problem entirely. Worth reusing at F37.

**Open at the close of Phase 0.**

- **`auth_leaked_password_protection` is disabled** — a new WARN from `get_advisors security` that F03 did not see. Low impact here, since no real user ever sets a password (Google OAuth only; the email provider exists solely so F03's suite can `signInWithPassword` against admin-created users). Enabling it is a dashboard change and was left alone rather than made silently. Worth deciding at F38.
- **`prompts_tags_idx` is still an unused index.** Correct — nothing queries it until F24.
- **No migration has been proven to replay from an empty database.** Unchanged since F02, and it stays true until a local stack exists.
