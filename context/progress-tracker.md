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

**Phase:** Phase 1 — Core chat — **complete and checkpointed.** Phase 2 not started
**Last completed:** Phase 1 checkpoint — typecheck, lint, a clean-`.next` build, and 95 tests green; the phase diff reviewed (41 files, +3,793); the boundary invariants re-checked mechanically (no `.from()` outside `src/server/data/`, no `src/components/` or `src/lib/` import of `src/server/`, every `src/server/` file carrying `server-only`, no secret read outside `env.ts`, no `getSession()` authorisation, no `maxDuration`); Supabase security and performance advisors showing only the three known deliberate items and nothing new. One committed explanation was found wrong and corrected: F11's touch bug was blamed on hover and CSS source order, and reading the built stylesheet plus a direct measurement showed the real cause is the drawer's focus trap landing on the first row's overflow trigger. `build-journal.md` compacted — Phase 1's constraints promoted under two new topics, its six entries collapsed, a duplicate `Quota` heading merged
**Next:** 12 The encryption vault — the first feature of Phase 2

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
- [x] 08 Streaming responses on the shared key
- [x] 09 Message rendering
- [x] 10 Auto-generated titles
- [x] 11 Delete conversation
- [x] Phase checkpoint — verify Phase 1 — Core chat is stable before starting the next phase

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

1. **A row inside the mobile drawer matches `:focus-within` the moment the drawer opens, so `group-focus-within:opacity-0` hides things nobody touched.** Radix's Sheet traps focus and moves it to the first focusable descendant, which is the *first row's own overflow trigger* — measured directly: `document.activeElement` is `BUTTON[Options for …]` and the first `<li>` matches `:focus-within` with no user action. A `pointer-coarse:opacity-100` counterpart does not save it, because Tailwind emits `group-focus-within:opacity-0` **after** `pointer-coarse:opacity-100` (31410 vs 31134 in the built CSS) and both are single-class specificity. The timestamp measured `opacity: 0` at 360px — the exact "unreachable without hover" defect DESIGN.md forbids, on a device with no way to move focus off it. Fix: scope every *hiding* rule to `pointer-fine`, so the coarse default is everything visible. Note the narrower rule this replaces an earlier, wrong guess about hover and source order: a pair that both *reveal* (`opacity-0` + `group-hover:opacity-100` + `pointer-coarse:opacity-100`, as in `MessageBubble`) has no conflict and is fine. (F11)
2. **Title generation must not route through `resolveModel()`, and that is the whole shape of the feature.** `resolveModel()` is where F16 inserts `reserveSharedSlot()`, so sharing that path would silently start charging every user one of twenty daily messages for a title they never asked for — a quota invariant broken by a feature that never mentions quota, with nothing on screen to say so. `sharedTitleModel()` is a separate export in `providers.ts` taking no user id, so there is nobody to charge and no reservation to add by accident; a test asserts its arity is zero. The same reasoning left F17's two hooks marked rather than half-built: the breaker skip, and recording usage into `shared_key_budget`. Note the sweep cannot cover for the second — it derives usage from `messages` rows carrying `used_shared_key`, and a title writes no message row. (F10)
3. **Syntax highlighting runs in the browser, and cannot run anywhere else.** `library-docs.md` said "on the server where possible" and `architecture.md` cited the highlighter as its example of a warm-process cache; both were wrong for this app. The thread lives inside `Chat`, a Client Component holding `useChat` state, so a streaming message does not exist on the server at render time — and after `router.refresh()` even persisted messages re-render from client state. Two renderers would disagree about the same message. What makes the browser affordable: shiki's JavaScript RegExp engine instead of ~1 MB of Oniguruma WASM, and dynamic imports throughout, so a conversation with no code fence downloads none of it. The allowlist that survives is a *compatibility* guarantee — the JS engine cannot emulate every Oniguruma pattern, and `forgiving: true` would swallow exactly that — proven by a test that loads all twelve grammars for real. (F09)
4. **A partial answer must be accumulated in `onChunk`; `onAbort` will not give it to you.** `onAbort` receives only `steps`, and a single-step generation stopped mid-flight has none — stopping with 1,250 characters on screen persisted an empty row, silently breaking the invariant that an aborted stream keeps what arrived. The accumulator is written from both `onAbort` and `onError`. The wider lesson holds for the whole SDK: read the installed `.d.ts`, since the same pass found `onFinish` demoted to a deprecated alias of `onEnd`. (F08)
5. **Conversation creation lives inside `POST /api/chat`, not a separate endpoint.** `conversationId` is nullable and null means "create one". The reason is the refusal path: from F16 a quota wall and from F17 a tripped breaker must leave *no* trace, and a dedicated `/api/conversations` puts creation on the far side of that check — every refusal would strand an empty "New chat" in the sidebar. One handler owning both the creation and the refusal is what keeps the invariant true. `architecture.md` and `library-docs.md` both showed the non-nullable shape and were corrected in place. (F07)
6. **Server data reaches a component as an unawaited promise when it must not block the frame.** `ConversationList` cannot call `listConversations()` itself — nothing under `src/components/` may import from `src/server/`, and the lint rule caught the first draft doing exactly that. Awaiting in `(app)/layout.tsx` instead would have blocked the whole three-column shell on a database round trip and left the skeleton unreachable. The layout starts the query, hands the pending promise down, and the sidebar awaits it inside a `Suspense` boundary — the fetch begins before the profile resolves and the frame still paints first. Reusable wherever a column needs data the shell should not wait for. (F06)
7. **Shell layout state lives in a cookie, because the layout is a Server Component.** `build-plan.md` said `localStorage`, which cannot be read during a server render — the sidebar would paint expanded and snap shut after hydration, on every navigation, for exactly the people who chose to close it. The cookie is read with `await cookies()` and written with one line of `document.cookie`; no route handler, no provider, no `router.refresh()`. Proven by fetching the raw server HTML and confirming it arrives with the collapsed classes already applied. (F05)
8. **Sheet motion is entry-only — never add a closing animation.** Radix defers unmounting to an `animationend` when the computed animation-name changes on close; when it does not fire, the overlay unmounts and the panel stays on top of the page, visible and interactive. Observed directly: Escape left the sidebar stranded at `data-state="closed"`. No exit keyframe means the name stays `none` and Radix unmounts at once. A transition cannot substitute — Radix listens for `animationend`, not `transitionend`. (F05)
9. **Supabase's "Allow new users to sign up" is global, so it stays ON.** It sits beside the email provider in the dashboard but governs every provider — turning it off would stop new Google users from ever creating an account. The email-signup endpoint therefore stays reachable; what makes that safe is `mailer_autoconfirm = false`, which means `signUp` issues no session and so cannot mint a JWT that spends shared quota. Pinned by `tests/auth/auth-config.test.ts`, because dashboard settings have no diff. (F04)
10. **Every RLS policy is `(select auth.uid()) = user_id`, scoped `to authenticated`.** The bare `auth.uid()` is re-evaluated once per row (`auth_rls_initplan`); omitting the role clause makes owner policies overlap the `anon` share policies, which Postgres ORs per row (`multiple_permissive_policies`). Both forms are silently correct and quietly slow, which is why the rule is written down rather than left to judgement. (F03)
