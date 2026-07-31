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

### Database access

- **`public.handle_new_user()` is the one sanctioned `security definer` function in this codebase.** `library-docs.md` forbids `security definer` without a written reason; this is that reason. The function is fired by an insert on `auth.users`, executes as the auth admin role, and must write into `public.profiles` — there is no invoker-rights formulation that can do this, because the inserting role has no rights on `public`. It is written defensively for a reason Supabase states outright: **a trigger that raises blocks signup.** Hence `set search_path = ''` with every name fully qualified, a `coalesce` chain over the Google identity's metadata keys, and `on conflict (id) do nothing`. `execute` is revoked from `public`, `anon`, and `authenticated`. Any *further* `security definer` function needs its own entry here. (F02)
- **`shared_key_budget` gets no RLS policy — not in F03, not ever.** RLS is enabled and no policy is defined for any role, which makes the table unreachable through the anon key by construction rather than by rule. It is a global counter with no owner, so there is no `auth.uid()` to scope a policy to. The Supabase advisor reports `rls_enabled_no_policy` against it permanently; that notice is correct and must not be "fixed". (F02)
- **Extensions are created `with schema extensions`.** A bare `create extension pg_net` registers into `public` and trips the linter's `extension_in_public`. `pg_cron` is the exception — Supabase places it in `pg_catalog` and it publishes through its own `cron` schema. (F02)

- **Every RLS policy uses `(select auth.uid())` and is scoped `to authenticated`.** The bare `auth.uid()` is volatile to the planner and re-evaluated once per row; the subquery form is cached as an InitPlan. The role clause stops owner policies applying to `anon`, where they would overlap the share policies on `conversations` and `messages` and force Postgres to OR them per row. Both mistakes are functionally correct and quietly slow, which is why they are rules rather than judgement calls. The linter names them `auth_rls_initplan` and `multiple_permissive_policies`. (F03)
- **Two tables deviate from the uniform owner shape, on purpose.** `profiles` has no insert policy (the `security definer` trigger creates the row) and no delete policy (deleting it orphans the user against a surviving `auth.users` row that will never fire the trigger again). `shared_key_usage` has no delete policy — dropping that row is precisely how a user would reset their own daily allowance. Both are narrowings; do not "restore consistency" by adding the missing commands. (F03)
- **An owner can read their own `provider_keys.ciphertext`, `iv`, and `auth_tag` through PostgREST.** RLS is row-level, not column-level. Accepted, not overlooked: it is the user's own key material and is undecryptable without `ENCRYPTION_KEY`, which never leaves the server. A column-level `revoke` would close it but break `getDecryptedKey()` (F13), which must use the user-scoped client because the service-role client is reserved for `quota.ts`. (F03)
- **The `attachments` bucket is private and stays private.** Storage paths must begin with the owner's user id, because the object policies match on the first path segment and nothing else — a path built any other way is unreachable by its own owner. (F03)

### Testing

- **Data and policy tests run against the hosted project and own their fixtures.** There is no local stack and no `seed.sql`. The pattern, established in `tests/rls/isolation.test.ts` and to be reused by every later data test: `auth.admin.createUser({ email_confirm: true })` on the service-role client with a `crypto.randomUUID()` email, then `signInWithPassword` on a publishable-key client to get a real JWT, then assertions through that client. `afterAll` deletes the users and the cascade clears the rest. (F03)
- **Seed fixtures with the service-role client, never through the policies under test.** If seeding goes through a policy that is broken, the table ends up empty and every "cannot see the other user's row" assertion passes for entirely the wrong reason. (F03)
- **Delete storage objects before deleting an auth user.** Supabase refuses to delete a user who still owns objects, and reports it as a generic delete failure that looks nothing like the cause. (F03)
- **A test suite that has never failed proves nothing.** The RLS suite was verified by weakening a policy to `using (true)`, confirming exactly the two expected tests went red, and restoring it. Any future change to these policies should be checked the same way. (F03)

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

### Phase 0 — Foundation

#### Feature 03 — Row-Level Security policies  *(2026-07-31)*

Migrations `20260731071513` rls_policies and `20260731071540` storage_bucket.
27 owner policies across seven tables, the two `anon` share policies, a private
`attachments` bucket with four object policies, and a 16-test isolation suite.
`@supabase/supabase-js` 2.111.0 added.

- Decision: **`(select auth.uid())` and `to authenticated` on every policy**, against `architecture.md`'s example, which showed the bare form with no role clause. Both mistakes are functionally correct and quietly slow. `architecture.md` amended.
- Decision: **the two `anon` share policies land here, not at F33.** F33 already reads "the anon RLS policies from Phase 0 are what make the page readable", so leaving them out would have handed that feature a gap it did not expect to fill. It also meant the anon exposure surface could be tested in one place while the harness existed.
- Decision: **`profiles` and `shared_key_usage` deviate from the uniform owner shape**, both by narrowing. Filed under Standing Constraints so nobody later "fixes" the inconsistency.
- Decision: **no `supabase/seed.sql`.** `supabase db reset` is what runs a seed file and F02 removed the local stack, so it would have been a second source of fixture truth that never executed. Suites own their fixtures. `build-plan.md` F36 and `library-docs.md` amended to match.
- Decision: **fixtures seeded with the service-role client**, deliberately bypassing the policies under test. Seeding through them would let a broken insert policy leave the table empty and turn every isolation assertion green for the wrong reason.
- Decision: **the email-signup hole is F04's to close**, not this feature's. Recorded below because it is currently open.

**Gotchas.**

- **`loadEnv` from `vite` is unreachable.** The plan called for it to read `.env.local` into the test env, but pnpm's strict linking does not expose `vite` at the project root — it is only a transitive dependency of Vitest — and adding it directly to reach one helper fails the Dependencies gate. Replaced with a short parser in `vitest.config.ts` that splits on the **first** `=`, which matters because `ENCRYPTION_KEY` is base64 and ends in padding.
- **The suite's first draft swallowed its own error message.** The module-level `createClient` calls ran before `beforeAll`, so a missing `SUPABASE_SECRET_KEY` surfaced as supabase-js's opaque `"supabaseKey is required"` instead of the actionable message written for exactly that case. Env is now validated at module scope, before any client is constructed.
- **`storage.remove()` reports success for paths the caller cannot see.** The obvious assertion — that the call errors — passes vacuously. The only honest check is whether the object survived, so the test lists the prefix as service role afterwards and asserts it is still there.
- **A leftover from F02, found and fixed here:** `move_pg_net_to_extensions.sql` had been committed as `20260731071500` while the platform recorded `20260731065531`. A future `supabase link && db push` would have re-applied it. All five migration filenames now match their recorded versions.

- Verified: 16 tests pass. Cross-user read by explicit row id, update, delete, and insert-as-someone-else are all refused across `conversations`, `messages`, `prompts`, `provider_keys` and `shared_key_usage`; an unauthenticated publishable-key client reads zero rows from all eight tables.
- Verified: **the suite fails when it should.** Weakening `conversations`' owner-read policy to `using (true)` turned exactly two tests red — "sees their own conversation and nobody else's" and "cannot read a conversation by its id" — and restoring it turned them green. A suite that has never failed is indistinguishable from one that asserts nothing.
- Verified: the share path end to end — a conversation is invisible to `anon`, becomes visible with its messages once `share_slug` is set, and vanishes again the moment the slug is nulled. Another user's unshared conversation stays invisible throughout.
- Verified: user A cannot download an object under user B's storage prefix, and the object survives A's delete attempt.
- Verified: `get_advisors security` reports **only** `shared_key_budget` / `rls_enabled_no_policy`. `get_advisors performance` reports no `auth_rls_initplan` and no `multiple_permissive_policies` — just an `unused_index` INFO on `prompts_tags_idx`, which has no queries yet.
- Verified: teardown is complete — 0 `auth.users`, 0 rows in every public table, 0 storage objects, budget singleton intact.
- Verified: `pnpm typecheck`, `pnpm lint`, and `pnpm build` with `.env.local` moved aside all exit 0.

**Open and deliberately deferred:** the email provider is enabled by default, so
anyone can POST `/auth/v1/signup` and receive a valid session that could spend
shared Gemini quota through `/api/chat`. F04 closes it. **F04 must disable
*signups*, not the *email provider*** — this suite authenticates with
`signInWithPassword` against admin-created users, and killing the provider takes
all 16 tests down for a reason that will look nothing like the cause.

#### Feature 02 — Supabase project and schema migration  *(2026-07-31)*

Project `promptx` / `kplbxqujihxzdltrwxbw`, region `ap-southeast-1`, Postgres
17.6, pg_cron 1.6.4, pg_net 0.20.4. Three migrations recorded: `20260731065201`
enums_and_tables, `20260731065321` scheduled_jobs, `20260731071500`
move_pg_net_to_extensions.

- Decision: **hosted-only, no local stack.** Docker is not installed on this machine, so the CLI workflow the context docs assume was traded away deliberately. The cost is real and worth restating: `supabase db reset` is the only thing that proves a migration replays from an empty database, and nothing in this workflow can prove that. Migration files stay the committed source of truth; MCP `apply_migration` is only the delivery mechanism.
- Decision: **a new project rather than the existing empty one.** `rbkappvgdcsxwegxpohi` sat idle in `ap-northeast-1` (Tokyo); region is immutable, and Singapore is the closer Render free-tier region. Cost confirmed $0/month before creating. The Tokyo project is left alone, not deleted.
- Decision: **RLS enabled here, policies in F03.** `build-plan.md` put both in F03, but combined with the hosted-only choice that would have left eight tables world-readable through a live publishable key for however long F03 took. Enabling RLS with no policies is deny-all — one line per table.
- Decision: **the reaper's service key lives in Vault**, read through `vault.decrypted_secrets`, not in a database setting. `library-docs.md`'s `current_setting('app.settings.service_key')` example would store a service_role key in plaintext configuration readable by anything that can call `show`.
- Decision: **migration filenames renamed to match the versions the platform recorded.** MCP assigns its own timestamp; leaving the local names out of sync would double-apply everything on a future `supabase link && db push`.
- Decision: **`attachments.status` got a `check` constraint** for its three documented states, but `size_bytes` did **not** get one. The states are self-contained; a size cap would duplicate `MAX_ATTACHMENT_BYTES` from `src/lib/constants.ts` into a second source of truth that drifts silently. F28 enforces size server-side.

**Gotchas.**

- **`create extension pg_net` registers into `public`.** The security advisor caught it as `extension_in_public` (WARN). Fixed by an append-only third migration that drops and recreates it `with schema extensions` rather than by editing an already-applied file. `ALTER EXTENSION … SET SCHEMA` was avoided on purpose — pg_net publishes through its own `net` schema, and a partially relocatable extension either errors or half-moves. Verified afterwards that `net.http_post` still resolves.
- **plpgsql resolves names at runtime, so a migration creating a function body full of nonexistent objects still succeeds.** `reap_attachments_tick()` compiled clean while referencing `net.http_post`; that it actually resolves had to be checked separately against `pg_proc`. Worth remembering for every future function.
- **The two indexes the data model implies but does not list.** `architecture.md` says "`user_id` | Not null, indexed" for several tables, but most of those are already covered as the leftmost column of a composite or unique index (`provider_keys` by its unique, `conversations` by the sidebar composite, `shared_key_usage` by its PK). Only `messages.user_id`, `attachments.user_id`, and `prompts.user_id` genuinely needed their own — three, not six. Adding all six would have cost write throughput for nothing.

- Verified: 8 tables, `rls_enabled: true` on every one; `get_advisors security` returns **no** `rls_disabled_in_public`, only the 8 expected `rls_enabled_no_policy` INFO notices.
- Verified: `anon` reads 0 rows from all seven user tables while real rows existed, and `authenticated` with a matching `sub` claim reads 0 too. Deny-all is real, not assumed.
- Verified: the profile trigger populated `display_name` and `avatar_url` from Google-shaped `raw_user_meta_data` on a probe insert into `auth.users`.
- Verified: `search_vector` builds on insert and matches `websearch_to_tsquery('english', 'ranks highlights')` against "…ranks results… and highlights them…" — stemming works through the generated column.
- Verified: `reconcile_shared_key_usage()` retired a 10-minute-old `streaming` row to `error`, left a live one streaming, lowered a stale counter 5→1 to match the one delivered generation, and left an equally-inflated *fresh* row at 5. The staleness guard is doing its job.
- Verified: `reap_attachments_tick()` returns clean with its Vault secrets absent, so the hourly job runs green until F28.
- Verified: deleting the probe users cascaded profiles, conversations, messages, and usage rows to zero, leaving only the budget singleton at `2026-07-01`.
- Verified: `pnpm typecheck`, `pnpm lint` pass, and `pnpm build` exits 0 **with `.env.local` moved aside** — nothing yet depends on the environment.
- Verified: both jobs actually **ran**, not merely scheduled — `cron.job_run_details` shows `reconcile-shared-quota` and `reap-orphaned-attachments` both `succeeded` at 07:00:00 UTC, the first boundary where their schedules coincided. Scheduled is not the same as running, and a silently failing pg_cron job is the main operational risk of choosing it over an HTTP cron.

#### Feature 01 — Project scaffold and design tokens  *(2026-07-31)*

Versions landed: Next 16.2.12, React 19.2.4, Tailwind v4.3.3, TypeScript 5.9.3,
zod 4.4.3, Vitest 4.1.10, pnpm 11.18.0 on Node 26.5.0.

- Decision: **shadcn retuned in place, no alias layer.** `globals.css` holds only the PromptX `@theme`; the CLI's ~60-variable `:root`/`.dark`/`@theme inline` block, its `@custom-variant dark`, and its Geist font injection were all removed. Each of the five primitives was hand-edited to tokens. The tradeoff accepted: a future `shadcn add` produces a visibly wrong component until retuned — treated as a forcing function for the rule `code-standards.md` already states.
- Decision: **the two quota env vars renamed `NEXT_PUBLIC_*`.** Next inlines only that prefix into client bundles, so unprefixed the composer would read `undefined`, fall back to 20, and disagree with whatever the server enforced. Cost: both are build-time inlined, so changing them on Render needs a rebuild.
- Decision: **`pnpm` installed via `npm`; `corepack` not assumed.** This machine's Node 26.5.0 ships npm only — `/opt/homebrew/lib/node_modules` contains just `npm` and `@github`. Feature 38's build command was amended to derive the pnpm version from `packageManager` instead of calling `corepack enable`.
- Decision: **query-location rule shipped as `no-restricted-syntax`** with `Array`/`Buffer`/`Object` receivers excluded, rather than the import-zone alternative, which would have needed `src/server/supabase.ts` (F02) and an `except` list that is not yet knowable.
- Decision: **Vitest now, Playwright at F36.** `CLAUDE.md` lists `pnpm test` among the F01–02 commands and F03's RLS suite needs it; nothing needs browser binaries until there is a spec.
- Decision: **`src/components/ui/` keeps kebab-case and multi-export files**, against the general PascalCase/one-per-file rule. These are vendored primitives we retune, renaming breaks `shadcn add`, and a Radix primitive is a family of parts.

**Gotchas — four silent failures found and closed. Every one of them compiled, linted, and typechecked cleanly.**

- **The `@theme` font tokens did not connect to `next/font`.** `architecture.md` declared `--font-sans: Inter, …` while the layout loaded Inter through `next/font`. Next 16 emits *two* families per face — the real `Inter` plus a metric-matched `Inter Fallback` (`local(Arial)`, `size-adjust: 107.12%`) — and only the CSS variable references both. The literal name still finds the self-hosted face but skips the metric-matched fallback, reintroducing exactly the layout shift `next/font` exists to prevent. Tokens now read `var(--font-inter)`.
- **The named spacing tokens shadow Tailwind's container scale.** `max-w-4xl` resolved to `--spacing-4xl` = **64px**, collapsing the whole proof page into a 64px column. By extension `max-w-md` was 10px and `max-w-xs` 4px — the dialog and tooltip were both broken and would have stayed broken into Phase 2. Fixed by numeric widths on the 4px grid plus an ESLint rule rejecting named width utilities, because the failure is otherwise invisible.
- **`cn()` was corrupting the design system.** `tailwind-merge` knows only Tailwind's default class groups: it could not distinguish `text-button-md` (size) from `text-on-primary` (colour), resolved them as one conflict and **dropped the type step** — every button rendered at the inherited 16px/400 instead of 14px/500 — and it did not recognise `rounded-pill` at all, keeping both it and `rounded-sm` and leaving the winner to CSS source order. `src/lib/utils.ts` now uses `extendTailwindMerge` with the full type and radius scales.
- **`server-only` throws under Vitest.** The package resolves to a module that throws unless the bundler sets the `react-server` condition, which Vitest does not — so every `src/server/` test would have failed at import time. Aliased to an empty stub in `vitest.config.ts`.

Two smaller ones: pnpm 11 leaves an `allowBuilds` placeholder in `pnpm-workspace.yaml` that makes `pnpm install` exit non-zero until answered per package (`sharp: false`, `unrs-resolver: true` — the latter is load-bearing, since it backs the resolver that lets `import/no-restricted-paths` see the `@/` alias). And Next inferred the workspace root as `$HOME` from a stray lockfile there, so `turbopack.root` is pinned in `next.config.ts`.

**Correction to a doc claim:** `architecture.md` said a cleared breakpoint makes `sm:flex-row` "fail to compile". It does not — Tailwind emits *nothing*, silently. Verified by injecting all five default prefixes and diffing the output CSS: zero new rules, no error. The protection is real, the failure mode is silence. Wording corrected.

- Verified: `pnpm lint`, `pnpm typecheck`, `pnpm test` (3 passing), and `pnpm build` **with no environment variables set** all exit 0.
- Verified: both `import/no-restricted-paths` zones and the `.from()` rule fire against deliberate probes, while `Buffer.from`/`Array.from`/`Object.keys` in the same file stay silent. The width rule fires on `max-w-md` and is silent on `max-w-112`. Probes deleted.
- Verified in-browser against the production build: canvas `rgb(43,38,34)`; `display-xl` 64px/70.4px/-1.6px/400; `display-md` 32/40/-0.8/500; `display-serif` Instrument Serif 48/52/-0.5/400; `code` DM Mono 13/18/400; primary button 14px/500/20px, 36px tall, 3px radius, `#f7f5f0` on `#2b2622`; focus ring `1px solid #f7f5f0` at 2px offset. No console errors.
- Verified: exactly two `min-width` media queries in the output CSS (48rem, 64rem); the radius namespace contains exactly DESIGN.md's seven steps; `src/components/ui/` contains no `zinc`/`slate`/`oklch`/`dark:`/`0.625rem`/`animate-in` and no dead breakpoint prefixes.
- **Not verified:** the visual breakpoint toggle at 768px/1024px. The browser window would not actually resize (`innerWidth` stayed 1635 despite the tool reporting success). The invariant is proven at the CSS level instead, which is the stronger check; a manual resize is worth one look at the Phase 0 checkpoint.

**Follow-up worth considering:** a lint rule rejecting `sm:`/`md:`/`lg:`/`xl:`/`2xl:` prefixes in class strings. Cleared breakpoints fail silently, so nothing currently catches a typo'd prefix — deliberately left out of F01 as scope, but it is the same class of bug as the width shadowing that did get a rule.
