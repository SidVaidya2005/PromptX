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

**Phase:** Phase 1 — Core chat — in progress
**Last completed:** 07 New conversation and composer — `POST /api/chat` (the first route handler) creating the conversation when `conversationId` is null, appending the user message, and touching `updated_at`; a composer shared by both chat pages with Enter/Shift+Enter, IME guard, and a 40dvh grow cap; a plaintext `Thread` for F09 to upgrade. Verified end to end in a browser, including every refusal path — someone else's conversation 404s and writes nothing. **This closed F06's open gap**: the active indicator is now confirmed
**Next:** 08 Streaming responses on the shared key

---

## Progress

### Phase 0 — Foundation

- [x] 01 Project scaffold and design tokens
- [x] 02 Supabase project and schema migration
- [x] 03 Row-Level Security policies
- [x] 04 Google Sign-In
- [x] 05 Application shell
- [x] Phase checkpoint — verify Phase 0 — Foundation is stable before starting the next phase

### Phase 1 — Core chat

- [x] 06 Conversation list
- [x] 07 New conversation and composer
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

1. **Conversation creation lives inside `POST /api/chat`, not a separate endpoint.** `conversationId` is nullable and null means "create one". The reason is the refusal path: from F16 a quota wall and from F17 a tripped breaker must leave *no* trace, and a dedicated `/api/conversations` puts creation on the far side of that check — every refusal would strand an empty "New chat" in the sidebar. One handler owning both the creation and the refusal is what keeps the invariant true. `architecture.md` and `library-docs.md` both showed the non-nullable shape and were corrected in place. (F07)
2. **Server data reaches a component as an unawaited promise when it must not block the frame.** `ConversationList` cannot call `listConversations()` itself — nothing under `src/components/` may import from `src/server/`, and the lint rule caught the first draft doing exactly that. Awaiting in `(app)/layout.tsx` instead would have blocked the whole three-column shell on a database round trip and left the skeleton unreachable. The layout starts the query, hands the pending promise down, and the sidebar awaits it inside a `Suspense` boundary — the fetch begins before the profile resolves and the frame still paints first. Reusable wherever a column needs data the shell should not wait for. (F06)
3. **Shell layout state lives in a cookie, because the layout is a Server Component.** `build-plan.md` said `localStorage`, which cannot be read during a server render — the sidebar would paint expanded and snap shut after hydration, on every navigation, for exactly the people who chose to close it. The cookie is read with `await cookies()` and written with one line of `document.cookie`; no route handler, no provider, no `router.refresh()`. Proven by fetching the raw server HTML and confirming it arrives with the collapsed classes already applied. (F05)
4. **Sheet motion is entry-only — never add a closing animation.** Radix defers unmounting to an `animationend` when the computed animation-name changes on close; when it does not fire, the overlay unmounts and the panel stays on top of the page, visible and interactive. Observed directly: Escape left the sidebar stranded at `data-state="closed"`. No exit keyframe means the name stays `none` and Radix unmounts at once. A transition cannot substitute — Radix listens for `animationend`, not `transitionend`. (F05)
5. **Supabase's "Allow new users to sign up" is global, so it stays ON.** It sits beside the email provider in the dashboard but governs every provider — turning it off would stop new Google users from ever creating an account. The email-signup endpoint therefore stays reachable; what makes that safe is `mailer_autoconfirm = false`, which means `signUp` issues no session and so cannot mint a JWT that spends shared quota. Pinned by `tests/auth/auth-config.test.ts`, because dashboard settings have no diff. (F04)
6. **Every RLS policy is `(select auth.uid()) = user_id`, scoped `to authenticated`.** The bare `auth.uid()` is re-evaluated once per row (`auth_rls_initplan`); omitting the role clause makes owner policies overlap the `anon` share policies, which Postgres ORs per row (`multiple_permissive_policies`). Both forms are silently correct and quietly slow, which is why the rule is written down rather than left to judgement. (F03)
7. **There is no local Supabase stack.** Migrations are authored as files under `supabase/migrations/` — still the source of truth — and delivered to the hosted project through the Supabase MCP. Consequences that bind everything downstream: no `supabase db reset`, so no migration is ever proven replayable from zero; types come from MCP `generate_typescript_types`, not `gen types --local`; and F03's RLS suite must run against the cloud instance. (F02)
8. **`cn()` must declare every custom token scale.** `tailwind-merge` knows only Tailwind's default class groups, so it dropped `text-button-md` when composed with `text-on-primary` and failed to dedupe `rounded-sm` against `rounded-pill`. `src/lib/utils.ts` uses `extendTailwindMerge`; a token added to `globals.css` and not to that list is silently unreliable. (F01, extended F05)
9. **Never use a named width utility.** The `DESIGN.md` spacing tokens shadow Tailwind's container scale — `max-w-md` is 10px, `max-w-xs` is 4px. Widths are numeric on the 4px grid (`max-w-112` = 448px), enforced by an ESLint rule. (F01)
10. **The `@theme` font tokens reference the `next/font` CSS variables**, not the family names, so the metric-matched fallback that prevents layout shift stays in the chain. (F01)
