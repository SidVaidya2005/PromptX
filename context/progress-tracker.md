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
**Last completed:** 10 Auto-generated titles — a conversation names itself from its first exchange on the shared key, through `POST /api/title` fired by the client once the stream closes. `sharedTitleModel()` is a deliberate second entry point that cannot claim a quota slot; the gate is "title is still 'New chat'", checked before the provider is reached, which also protects F21's manual rename for free. Verified against real Gemini: the sidebar went "New chat" → "Postgres GIN vs B-tree indexes" with a `window` marker proving no page reload, `/api/title` started 10 ms *after* the chat response closed, a second message made no title call, a repeat call refused in 727 ms against 3,639 ms for a real generation, and another user's eligible conversation came back `null` with its row untouched
**Next:** 11 Delete conversation

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

1. **Title generation must not route through `resolveModel()`, and that is the whole shape of the feature.** `resolveModel()` is where F16 inserts `reserveSharedSlot()`, so sharing that path would silently start charging every user one of twenty daily messages for a title they never asked for — a quota invariant broken by a feature that never mentions quota, with nothing on screen to say so. `sharedTitleModel()` is a separate export in `providers.ts` taking no user id, so there is nobody to charge and no reservation to add by accident; a test asserts its arity is zero. The same reasoning left F17's two hooks marked rather than half-built: the breaker skip, and recording usage into `shared_key_budget`. Note the sweep cannot cover for the second — it derives usage from `messages` rows carrying `used_shared_key`, and a title writes no message row. (F10)
2. **Syntax highlighting runs in the browser, and cannot run anywhere else.** `library-docs.md` said "on the server where possible" and `architecture.md` cited the highlighter as its example of a warm-process cache; both were wrong for this app. The thread lives inside `Chat`, a Client Component holding `useChat` state, so a streaming message does not exist on the server at render time — and after `router.refresh()` even persisted messages re-render from client state. Two renderers would disagree about the same message. What makes the browser affordable: shiki's JavaScript RegExp engine instead of ~1 MB of Oniguruma WASM, and dynamic imports throughout, so a conversation with no code fence downloads none of it. The allowlist that survives is a *compatibility* guarantee — the JS engine cannot emulate every Oniguruma pattern, and `forgiving: true` would swallow exactly that — proven by a test that loads all twelve grammars for real. (F09)
3. **A partial answer must be accumulated in `onChunk`; `onAbort` will not give it to you.** `onAbort` receives only `steps`, and a single-step generation stopped mid-flight has none — stopping with 1,250 characters on screen persisted an empty row, silently breaking the invariant that an aborted stream keeps what arrived. The accumulator is written from both `onAbort` and `onError`. The wider lesson holds for the whole SDK: read the installed `.d.ts`, since the same pass found `onFinish` demoted to a deprecated alias of `onEnd`. (F08)
4. **Conversation creation lives inside `POST /api/chat`, not a separate endpoint.** `conversationId` is nullable and null means "create one". The reason is the refusal path: from F16 a quota wall and from F17 a tripped breaker must leave *no* trace, and a dedicated `/api/conversations` puts creation on the far side of that check — every refusal would strand an empty "New chat" in the sidebar. One handler owning both the creation and the refusal is what keeps the invariant true. `architecture.md` and `library-docs.md` both showed the non-nullable shape and were corrected in place. (F07)
5. **Server data reaches a component as an unawaited promise when it must not block the frame.** `ConversationList` cannot call `listConversations()` itself — nothing under `src/components/` may import from `src/server/`, and the lint rule caught the first draft doing exactly that. Awaiting in `(app)/layout.tsx` instead would have blocked the whole three-column shell on a database round trip and left the skeleton unreachable. The layout starts the query, hands the pending promise down, and the sidebar awaits it inside a `Suspense` boundary — the fetch begins before the profile resolves and the frame still paints first. Reusable wherever a column needs data the shell should not wait for. (F06)
6. **Shell layout state lives in a cookie, because the layout is a Server Component.** `build-plan.md` said `localStorage`, which cannot be read during a server render — the sidebar would paint expanded and snap shut after hydration, on every navigation, for exactly the people who chose to close it. The cookie is read with `await cookies()` and written with one line of `document.cookie`; no route handler, no provider, no `router.refresh()`. Proven by fetching the raw server HTML and confirming it arrives with the collapsed classes already applied. (F05)
7. **Sheet motion is entry-only — never add a closing animation.** Radix defers unmounting to an `animationend` when the computed animation-name changes on close; when it does not fire, the overlay unmounts and the panel stays on top of the page, visible and interactive. Observed directly: Escape left the sidebar stranded at `data-state="closed"`. No exit keyframe means the name stays `none` and Radix unmounts at once. A transition cannot substitute — Radix listens for `animationend`, not `transitionend`. (F05)
8. **Supabase's "Allow new users to sign up" is global, so it stays ON.** It sits beside the email provider in the dashboard but governs every provider — turning it off would stop new Google users from ever creating an account. The email-signup endpoint therefore stays reachable; what makes that safe is `mailer_autoconfirm = false`, which means `signUp` issues no session and so cannot mint a JWT that spends shared quota. Pinned by `tests/auth/auth-config.test.ts`, because dashboard settings have no diff. (F04)
9. **Every RLS policy is `(select auth.uid()) = user_id`, scoped `to authenticated`.** The bare `auth.uid()` is re-evaluated once per row (`auth_rls_initplan`); omitting the role clause makes owner policies overlap the `anon` share policies, which Postgres ORs per row (`multiple_permissive_policies`). Both forms are silently correct and quietly slow, which is why the rule is written down rather than left to judgement. (F03)
10. **There is no local Supabase stack.** Migrations are authored as files under `supabase/migrations/` — still the source of truth — and delivered to the hosted project through the Supabase MCP. Consequences that bind everything downstream: no `supabase db reset`, so no migration is ever proven replayable from zero; types come from MCP `generate_typescript_types`, not `gen types --local`; and F03's RLS suite must run against the cloud instance. (F02)
