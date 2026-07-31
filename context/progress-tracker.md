# Progress Tracker

> **Role:** Live build status — what's done, in progress, and next.
> **Read at the start of every session**; **update after every completed feature.**
> **Relates to:** mirrors `build-plan.md` exactly.

Any AI agent reading this should immediately know what is done, what is in
progress, and what is next.

## How this file is maintained

- **Current Status is overwritten, never appended.** It holds three lines describing only the latest state. Do not keep previous statuses here — the record of what happened lives in `build-journal.md`.
- **Progress checkboxes are edited in place** — tick the box for the completed feature. Never restate, duplicate, or re-list the checklist.
- **Key Decisions holds the 10 most recent decisions, newest first.** When adding an 11th, file the oldest bullet under its topic in `build-journal.md` → **Standing Constraints**, so this section never exceeds 10. Eviction is a move, never a delete — an old decision can still bind.

---

## Current Status

**Phase:** Phase 0 — Foundation
**Last completed:** 04 Google Sign-In — the full loop verified against a real Google account (sign in → `/chat` → sign out → guard), the real landing page replacing the token proof page, session refresh in `src/proxy.ts`, and a config guard test that pins the auth settings a dashboard could silently change. F03's closing instruction to disable signups was found to be wrong and corrected: `DISABLE_SIGNUP` is global and would have blocked new Google users
**Next:** 05 Application shell

---

## Progress

### Phase 0 — Foundation

- [x] 01 Project scaffold and design tokens
- [x] 02 Supabase project and schema migration
- [x] 03 Row-Level Security policies
- [x] 04 Google Sign-In
- [ ] 05 Application shell
- [ ] Phase checkpoint — verify Phase 0 — Foundation is stable before starting the next phase

### Phase 1 — Core chat

- [ ] 06 Conversation list
- [ ] 07 New conversation and composer
- [ ] 08 Streaming responses on the shared key
- [ ] 09 Message rendering
- [ ] 10 Auto-generated titles
- [ ] 11 Delete conversation
- [ ] Phase checkpoint — verify Phase 1 — Core chat is stable before starting the next phase

### Phase 2 — Bring your own key

- [ ] 12 The encryption vault
- [ ] 13 Key management
- [ ] 14 Provider registry and model catalog
- [ ] 15 Model picker
- [ ] 16 Shared-key quota
- [ ] 17 Global circuit breaker
- [ ] Phase checkpoint — verify Phase 2 — Bring your own key is stable before starting the next phase

### Phase 3 — Conversation craft

- [ ] 18 Message outline rail
- [ ] 19 Edit and resend
- [ ] 20 Regenerate
- [ ] 21 Rename and pin
- [ ] 22 Archive
- [ ] 23 Per-conversation system prompt
- [ ] Phase checkpoint — verify Phase 3 — Conversation craft is stable before starting the next phase

### Phase 4 — Prompt library and search

- [ ] 24 Prompt library
- [ ] 25 Insert a prompt into the composer
- [ ] 26 Full-text search backend
- [ ] 27 Search interface
- [ ] Phase checkpoint — verify Phase 4 — Prompt library and search is stable before starting the next phase

### Phase 5 — Attachments

- [ ] 28 Upload pipeline
- [ ] 29 Attachment interface
- [ ] 30 Capability gating
- [ ] Phase checkpoint — verify Phase 5 — Attachments is stable before starting the next phase

### Phase 6 — Compare, share, export

- [ ] 31 Compare view
- [ ] 32 Promote a comparison
- [ ] 33 Public share links
- [ ] 34 Export
- [ ] Phase checkpoint — verify Phase 6 — Compare, share, export is stable before starting the next phase

### Phase 7 — Hardening and release

- [ ] 35 Unit test suite
- [ ] 36 End-to-end suite
- [ ] 37 Accessibility and responsive pass
- [ ] 38 Deployment
- [ ] Phase checkpoint — verify Phase 7 — Hardening and release is stable before starting the next phase

---

## Key Decisions

1. **Supabase's "Allow new users to sign up" is global, so it stays ON.** It sits beside the email provider in the dashboard but governs every provider — turning it off would stop new Google users from ever creating an account. The email-signup endpoint therefore stays reachable; what makes that safe is `mailer_autoconfirm = false`, which means `signUp` issues no session and so cannot mint a JWT that spends shared quota. Pinned by `tests/auth/auth-config.test.ts`, because dashboard settings have no diff. (F04)
2. **Every RLS policy is `(select auth.uid()) = user_id`, scoped `to authenticated`.** The bare `auth.uid()` is re-evaluated once per row (`auth_rls_initplan`); omitting the role clause makes owner policies overlap the `anon` share policies, which Postgres ORs per row (`multiple_permissive_policies`). Both forms are silently correct and quietly slow, which is why the rule is written down rather than left to judgement. (F03)
3. **There is no local Supabase stack.** Migrations are authored as files under `supabase/migrations/` — still the source of truth — and delivered to the hosted project through the Supabase MCP. Consequences that bind everything downstream: no `supabase db reset`, so no migration is ever proven replayable from zero; types come from MCP `generate_typescript_types`, not `gen types --local`; and F03's RLS suite must run against the cloud instance. (F02)
4. **`cn()` must declare every custom token scale.** `tailwind-merge` knows only Tailwind's default class groups, so it dropped `text-button-md` when composed with `text-on-primary` and failed to dedupe `rounded-sm` against `rounded-pill`. `src/lib/utils.ts` uses `extendTailwindMerge`; a token added to `globals.css` and not to that list is silently unreliable. (F01)
5. **Never use a named width utility.** The `DESIGN.md` spacing tokens shadow Tailwind's container scale — `max-w-md` is 10px, `max-w-xs` is 4px. Widths are numeric on the 4px grid (`max-w-112` = 448px), enforced by an ESLint rule. (F01)
6. **The `@theme` font tokens reference the `next/font` CSS variables**, not the family names, so the metric-matched fallback that prevents layout shift stays in the chain. (F01)
7. **shadcn primitives are retuned in place, with no alias layer.** One vocabulary; a freshly added component looks wrong until retuned, which is the point. (F01)
8. **The two quota limits are `NEXT_PUBLIC_*`.** Next inlines only that prefix into client bundles, and the composer displays the cap — unprefixed, the UI and the server would disagree silently. (F01)
9. **`corepack` is not assumed to exist.** Node 26 does not ship it; `pnpm` is installed via `npm` and feature 38's build command was amended accordingly. (F01)
10. **Unit tests live in `tests/`, and `server-only` is aliased to an empty stub under Vitest** — otherwise every `src/server/` module throws at import time. (F01)
