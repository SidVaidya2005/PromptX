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

_None yet._

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
