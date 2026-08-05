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

**Phase:** Phase 2 — Bring your own key — in progress
**Last completed:** 14 Provider registry and model catalog — `src/lib/models.ts` (`MODEL_CATALOG`, `findModel()`), `resolveModel()` extended to all four providers with a private `instantiate()`, a new `UnknownModelError` → `400 unknown_model`, and the three missing provider packages installed. 153 tests, typecheck, lint, and a production build green. Every shipped model id was listed from a live endpoint and then proven by a real generation — with `gemini-2.5-flash` used as a control, which failed exactly as F08 predicted. **F13's `bytea` round trip is now proven against a real credential**: a stored OpenRouter key decrypted and authenticated on the first send, and the answer streamed back with `provider = 'openrouter'`, the right `model_id`, `used_shared_key = false`, and measured tokens. `openai` and `anthropic` ship as empty catalogs — no key was available to prove an id for either, so they refuse with a message that names the empty catalog rather than the model id
**Next:** 15 Model picker — the composer control that makes the catalog reachable, and the first place the two empty catalogs become visible to a user

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

- [x] 12 The encryption vault
- [x] 13 Key management
- [x] 14 Provider registry and model catalog
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

1. **A catalog that only feeds a picker is decoration; this one refuses, and refusing is what gives an empty catalog teeth.** `architecture.md` had said since F02 that `model_id` "must exist in the catalog in `src/lib/models.ts`" — a file that did not exist, guarding a column that accepted any string ≤120 chars. F14 made it real by checking membership in `resolveModel()` and **only** there: not in `chatRequestSchema` as well, because one rule in two files is two rules free to drift, which is exactly what F12 had to unpick in the vault. The check runs *before* the key lookup, since an unknown model cannot succeed and refusing first avoids a database round trip and a decrypt — a mutation moving it below `getDecryptedKey()` turned exactly one test red, which is how that ordering is known to be load-bearing rather than incidental. The consequence lands on `openai` and `anthropic`, which ship as **empty arrays** because no key existed to prove a single id for either: a user with a valid, stored, working OpenAI key still cannot send a message. That is not a bug to route around but the honest state of the product, so `UnknownModelError` builds its message from the catalog and says "PromptX has no OpenAI models available yet" rather than blaming a model id that was never wrong. F15's picker will show both groups empty, which is the right place for it to be visible. (F14)
2. **"Listed" and "available" are different claims, and only one of them can be checked for free.** Every id in the catalog was read from a live endpoint *and then generated against*, because the endpoint is not evidence: Google still lists `gemini-2.5-flash` and answers a real request to it with "no longer available to new users". That id was run as a deliberate control and failed as predicted, which is the only reason the four passes mean anything. The same pass killed a Pro tier — `gemini-3.1-pro-preview` is listed, is not on the shared key's free tier, and so is absent rather than shipped hopefully. The wider rule: for anything a provider publishes about itself, a catalog read is a hypothesis and a real call is the test. (F14)
3. **`bytea` is a hex string over PostgREST, and getting it wrong fails silently in the worst possible place.** There is no binary type in JSON, so PostgREST renders `bytea` as `\x…` — which is why `src/types/database.ts` types `ciphertext`, `iv`, and `auth_tag` as `string` rather than `Buffer`. Handing supabase-js a `Buffer` does not throw: it serialises to `{"type":"Buffer","data":[…]}`, Postgres stores those bytes, the write reports **success**, and the corruption only surfaces whenever something next tries to decrypt — which for a provider key means feature 14, against a real user's credential. Measured by mutation: removing the conversion left the stored ciphertext decoding to `{"type":"Buffer"…`. So the conversion lives in exactly one module, `src/server/data/provider-keys.ts`, everything above it speaks `Buffer`, and a test writes and reads back through the real database rather than reasoning about the format. `architecture.md`'s claim that `bytea` means "no re-encoding round-trip to get wrong" was corrected — over PostgREST that round trip is unavoidable. (F13)
4. **A key probe distinguishes "your key is wrong" from "we could not find out", and both refuse.** `401`/`403` is the provider rejecting the key → `400 invalid_key`. A timeout, a 5xx, or a network error → `503 probe_unavailable`. Neither writes a row, so a refusal leaves no half-configured provider behind. Collapsing the two would tell someone their correct key is invalid because a provider had a bad minute, and send them off to regenerate a key that was fine. The probe itself is a free models-endpoint call rather than a generation: zero tokens, and no dependency on the model catalog that does not exist until F14. (F13)
5. **A test suite that passes under a mutation is not proof, and the mutation that breaks a test is rarely the one you expect.** The vault suite was checked two ways. Deleting `setAuthTag` — the integrity check itself — left all three tamper tests **green**, because node refuses `final()` on a GCM decipher that was never given a tag, so they threw for an unrelated reason; the *round-trip* tests are what went red. A second mutation, making `decrypt()` return `''` instead of throwing, turned the tamper tests red as intended — and exposed that a fourth test was passing by swallowing its own assertion, because its `expect.unreachable()` threw inside the `try` its own `catch` was waiting on. Both halves of the suite are load-bearing and neither covers the other. Predicting which test catches which defect is not a substitute for running it. (F12)
6. **The vault reads `serverEnv.ENCRYPTION_KEY`, never `process.env`, and validates nothing.** `architecture.md` carried two invariants that could not both hold — "every secret environment variable is read through `src/server/env.ts` and nowhere else" against "`vault.ts` … the only module that reads `ENCRYPTION_KEY`" — and its canonical snippet re-checked the 32-byte length that `env.ts:22-27` had already proven at boot, leaving one rule in two places free to drift. `env.ts` won: the vault consumes `serverEnv` and carries no length check, the invariant was narrowed to describe *use* rather than *read*, and both the snippet and `library-docs.md`'s test guidance were corrected — the latter taught `vi.stubEnv`, which cannot reach a value parsed once at module load. The suite uses `vi.resetModules()` + dynamic import instead. (F12)
7. **A row inside the mobile drawer matches `:focus-within` the moment the drawer opens, so `group-focus-within:opacity-0` hides things nobody touched.** Radix's Sheet traps focus and moves it to the first focusable descendant, which is the *first row's own overflow trigger* — measured directly: `document.activeElement` is `BUTTON[Options for …]` and the first `<li>` matches `:focus-within` with no user action. A `pointer-coarse:opacity-100` counterpart does not save it, because Tailwind emits `group-focus-within:opacity-0` **after** `pointer-coarse:opacity-100` (31410 vs 31134 in the built CSS) and both are single-class specificity. The timestamp measured `opacity: 0` at 360px — the exact "unreachable without hover" defect DESIGN.md forbids, on a device with no way to move focus off it. Fix: scope every *hiding* rule to `pointer-fine`, so the coarse default is everything visible. Note the narrower rule this replaces an earlier, wrong guess about hover and source order: a pair that both *reveal* (`opacity-0` + `group-hover:opacity-100` + `pointer-coarse:opacity-100`, as in `MessageBubble`) has no conflict and is fine. (F11)
8. **Title generation must not route through `resolveModel()`, and that is the whole shape of the feature.** `resolveModel()` is where F16 inserts `reserveSharedSlot()`, so sharing that path would silently start charging every user one of twenty daily messages for a title they never asked for — a quota invariant broken by a feature that never mentions quota, with nothing on screen to say so. `sharedTitleModel()` is a separate export in `providers.ts` taking no user id, so there is nobody to charge and no reservation to add by accident; a test asserts its arity is zero. The same reasoning left F17's two hooks marked rather than half-built: the breaker skip, and recording usage into `shared_key_budget`. Note the sweep cannot cover for the second — it derives usage from `messages` rows carrying `used_shared_key`, and a title writes no message row. (F10)
9. **Syntax highlighting runs in the browser, and cannot run anywhere else.** `library-docs.md` said "on the server where possible" and `architecture.md` cited the highlighter as its example of a warm-process cache; both were wrong for this app. The thread lives inside `Chat`, a Client Component holding `useChat` state, so a streaming message does not exist on the server at render time — and after `router.refresh()` even persisted messages re-render from client state. Two renderers would disagree about the same message. What makes the browser affordable: shiki's JavaScript RegExp engine instead of ~1 MB of Oniguruma WASM, and dynamic imports throughout, so a conversation with no code fence downloads none of it. The allowlist that survives is a *compatibility* guarantee — the JS engine cannot emulate every Oniguruma pattern, and `forgiving: true` would swallow exactly that — proven by a test that loads all twelve grammars for real. (F09)
10. **A partial answer must be accumulated in `onChunk`; `onAbort` will not give it to you.** `onAbort` receives only `steps`, and a single-step generation stopped mid-flight has none — stopping with 1,250 characters on screen persisted an empty row, silently breaking the invariant that an aborted stream keeps what arrived. The accumulator is written from both `onAbort` and `onError`. The wider lesson holds for the whole SDK: read the installed `.d.ts`, since the same pass found `onFinish` demoted to a deprecated alias of `onEnd`. (F08)
