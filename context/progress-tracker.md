# Progress Tracker

> **Role:** Live build status — what's done, in progress, and next.
> **Read at the start of every session**; **update after every completed feature.**
> **Relates to:** mirrors `build-plan.md` exactly; evicts old decisions to `constraints.md`.

Any AI agent reading this should immediately know what is done, what is in
progress, and what is next.

## How this file is maintained

- **Current Status is overwritten, never appended.** It holds three lines describing only the latest state. Do not keep previous statuses here — the record of what happened lives in `build-journal.md`.
- **Progress checkboxes are edited in place** — tick the box for the completed feature. Never restate, duplicate, or re-list the checklist.
- **Key Decisions holds the 10 most recent decisions, newest first.** When adding an 11th, file the oldest bullet under its topic in `constraints.md`, so this section never exceeds 10. Eviction is a move, never a delete — an old decision can still bind.

---

## Current Status

**Phase:** Phase 3 — Conversation craft
**Last completed:** 21 Rename and pin — 254 tests (17 new), typecheck, lint and a production build green. No migration: `pinned_at`, the sidebar index, the `Pinned` ordering and the grouping all shipped earlier, and auto-title suppression is *inherited* from `setGeneratedTitle()`'s `.eq('title', 'New chat')` guard rather than written — so the feature was a PATCH union, two data functions, and a sidebar row. The body is now three `.strict()` branches (model, rename, pin) and `.trim()` is declared before `.min(1)`; both were proven by mutation, as were the `updated_at`-untouched rule and the inherited title guard. **Three defects were found in the browser that no test could have caught**, all in the same input: an effect-based focus loses to Radix's trapped FocusScope and left `document.activeElement` on `BODY`; Escape reaches Radix's `document` capture listener before any React handler, so cancelling a rename at 360px closed the entire drawer; and a cancelled rename left `cancelledRef` set — React fires no blur on unmount — which silently ate the *next* rename's blur commit, keeping the typed title on screen while the database never heard about it. Every browser check was read back from the database rather than the screen, including that rename and pin leave `updated_at` byte-identical, and the 44px floor and no-duplicate-ids checks passed at 360px
**Next:** 22 Archive — `toggleArchive()` setting or clearing `archived_at`, `listConversations()` taking an `includeArchived` flag defaulting to false, a "Show archived" toggle in the sidebar footer, and archived conversations staying fully readable and searchable

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
- [x] 15 Model picker
- [x] 16 Shared-key quota
- [x] 17 Global circuit breaker
- [x] Phase checkpoint — verify Phase 2 — Bring your own key is stable before starting the next phase

### Phase 3 — Conversation craft

- [x] 18 Message outline rail
- [x] 19 Edit and resend
- [x] 20 Regenerate
- [x] 21 Rename and pin
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

1. **A rename input is three separate fights with the layer underneath it, and the unit suite could not have seen any of them.** F21's schema and data functions were proven by mutation and green on the first run; the feature was still broken three times over in the browser, all inside one `<input>`. Focusing it from an effect lost to Radix's trapped FocusScope — the input rendered with the right value while `document.activeElement` was `BODY` — so the focus moved to `onCloseAutoFocus`, the seam Radix provides for exactly this. Escape reached Radix before React did, because a Sheet dismisses from `document.addEventListener('keydown', …, { capture: true })`, which runs before the root listener React attaches: `stopPropagation()` in a React handler is already too late, and cancelling a rename at 360px closed the whole sidebar. The listener moved to `window`, one step above `document` in the capture path. And a cancelled rename left `cancelledRef` set forever — **React fires no blur for an element it unmounts** — so the *next* rename on that row silently discarded its own blur commit, keeping the typed title on screen while the database never heard about it. Each was found by driving the real thing and reading the database back, and each fix came from reading the installed package rather than reasoning about it. The rule this leaves: **when a component sits inside a library's focus or dismissal scope, that library's listeners are part of the component's control flow** — find out which phase and which target they use before assuming an event is yours to handle. The corollary is about refs: a flag cleared only on the event that consumes it stays set when that event never fires, so clear it where the interaction *starts*. (F21)
2. **A client cannot reliably name a database row, and the design that assumed it could passed every test before failing on the second click.** F20's first version identified the answer being replaced with the `messageId` the AI SDK hands `prepareSendMessagesRequest` — free, already there, obviously correct. It is a database uuid only when the message came from the server. A message that has just *streamed* carries an id the SDK generated, so the first regeneration worked and the next sent `a6i8GltgJ1K7KZtE` and was refused as a malformed uuid. Nothing in the suite could have caught it: every unit test constructs its own body, and the divergence only exists in a browser that has streamed once and not navigated. What made it survivable is that the id was never load-bearing — the route already required the target to be the *last* message, read from the database, so the id could only agree or disagree with something already known. It was dropped rather than repaired, and a `regenerate: true` flag says the same thing without pretending to identify a row. The general rule this leaves: **before sending an identifier, ask which side minted it.** Client-minted ids are for reconciling client state; only server-minted ids may name server state. The same divergence turned out to be live in F19's `editMessageId` in two separate ways, and both were fixed here rather than left: editing a message *sent* in the same session (the client id was invented from birth), and editing one *twice* (`sendMessage` pushed a new id while the database updated the original row in place). The fixes are a transient `data-prompt-message` part the client adopts in `onFinish`, and `sendMessage`'s own `messageId` option, which replaces a message keeping its id. Each was removed in turn and broke exactly one of the two cases. What made all of this hard to see is that a reload cures it, and a new conversation never shows it at all — `router.replace()` remounts `Chat` with database ids while `router.refresh()` does not. (F20)
3. **Three defects that compiled, linted, typechecked and looked correct, and the only thing that found any of them was checking a different surface than the one they broke.** F19's client called `sendMessage(...).catch(restore)` to put a thread back after a refused edit — the SDK's `makeRequest` catches, calls `onError`, and sets `status: 'error'` rather than rejecting, so that `.catch` could never run once. `prepareSendMessagesRequest` built its body from scratch and discarded the per-call `body` it is handed, so `editMessageId` never reached the server at all: the client truncated its view, the server appended, and **the screen looked perfect** — the database is what disagreed, and only after a reload. And a tie test written to guard the truncation order was flaky, because `(created_at, id)` breaks a tie on a random uuid and the fixture let the ids fall where they may; it passed about half the time and would have read as infrastructure noise rather than as a result. Each was caught by a different move: reading the installed `.d.ts` instead of trusting a promise-shaped API, querying the database instead of screenshotting the thread, and running a mutation that happened to fail the wrong test twice. The general rule is narrower than "test more" — **verify on the surface the code actually writes to, not the one that shows the outcome.** (F19)
4. **The rule that is right in one direction is the one to distrust, and scrolling has two directions.** The outline's active entry was first written as "the last anchor to cross the reading line", which reads as obviously correct and is — going down. Going up it is wrong in a way no amount of staring at it reveals: scrolling back past a prompt leaves that prompt as the most recent crossing while the reader is now above it, so the marker sticks to an exchange that has been left. The fix was to stop recording what an anchor *did* and record where it *is* — `IntersectionObserver` reports both, and position is direction-independent. Caught before shipping only because the browser pass walked the thread **both ways** rather than confirming the direction the feature was designed around: down held one prompt from scrollTop 400 to 2000 through a long answer, and up walked 3→2→1→0. The same session measured the other two claims instead of asserting them — the entries memo at 1 publish per streamed response against 14 without it, and the publish effect's cleanup by removing it and watching the previous conversation's rail follow the user onto `/settings`. A verification pass that only exercises the case the code was written for is a demonstration, not a test. (F18)
5. **A job with 800 consecutive successes had never once done its job, and only a deliberate orphan could tell the difference.** `reconcile_shared_key_usage()` has run on `pg_cron` every ten minutes since F02 shipped it on 2026-07-31 — `cron.job_run_details` is at runid 866 and shows an unbroken wall of green, which meant only that it executed, against a database that had no reservations to correct until F16 and no orphan since. `build-plan.md` §17 asked for a test that it releases a stale orphan and leaves a live one alone; F17 shipped without building it, and the checkpoint is where that was caught. The four tests written here are the first thing to watch the sweep act: it drops a stale counter to zero, leaves a fresh one at 3, declines to raise 0 to 1 when a delivered message outruns the reservation, and retires a `streaming` row abandoned mid-stream. Both mutations then showed what the guards are worth in the currency that matters — removing the staleness clause **zeroed a live reservation**, and removing `message_count > actual` **billed a user for a generation the reserve path had already missed**. A scheduled job is not verified by its exit status; it is verified by giving it something to fix and watching it fix that. (Phase 2 checkpoint)
6. **A derived column and an accumulated one are not the same ledger, and the cheaper-looking option undercounts.** `estimated_usd` could have been a running sum of per-call dollar deltas; instead it is recomputed from the exact `bigint` token totals on every write. The arithmetic was measured rather than guessed, and the first guess was wrong in an instructive way: a title-sized call is $0.00051, which does **not** vanish in a `numeric(10,4)` column as predicted — it stores as $0.0005. What it does is drift, always downward, so ten titles come to $0.0050 against a true $0.0051, and a mutation swapping derive for accumulate turned exactly that test red with exactly those figures. The stronger argument is structural and is the one that generalises: an accumulated dollar column is a second independent record of a fact the token columns already hold, free to disagree with them forever with nothing to notice — the same shape as F12's two-places validation and F15's two spellings of one rule. Derive from the exact thing; never keep a rounded copy alongside it. (F17)
7. **A test can be impossible to write, and the only way to find out is to break the thing it guards.** `build-plan.md` §16 asked for a concurrency test: ten simultaneous reservations at the boundary yielding exactly one success. It was written, it passed, and it was worthless. Replacing `reserve_shared_slot`'s single conditional upsert with a read-then-write — the exact implementation the guard exists to forbid — left it **green**; so did widening the race to a full second with `pg_sleep` between the read and the write, which must over-issue under any real overlap. Timing gave the reason: ten calls each sleeping a second took eleven seconds, and three further rounds of six parallel calls took ~6.8s apiece. Requests to the hosted project serialise, through a signed-in client, a header-only client, and a raw `fetch` alike, so no second statement ever lands inside the window. An early six-in-1.7s reading suggested otherwise and turned out to be a first-burst artifact that would not reproduce. The invariant is still held — `reserve_shared_slot` is a **single SQL statement**, structurally incapable of read-then-write, confirmed against the live database with `pg_get_functiondef` rather than against the migration file — but it is held by construction, not by the suite. The test was kept with an honest name and the measurement in its comment. The general rule: a green test is a claim, and the only evidence for it is watching it fail on purpose. (F16)
8. **A rule two runtimes both have to know gets one definition, not two spellings of it.** The picker greys out what a user cannot send to; `resolveModel()` refuses the same thing on the server. Written independently those are two expressions of one rule, and their disagreement is invisible in both directions — a picker offering a model every send then rejects, or hiding one that would have worked. So "what the shared key serves" became `isSharedModel()` in `src/lib/models.ts`, and `resolveModel()` was rewritten to call it rather than keep its own `provider !== 'google' || modelId !== SHARED_MODEL_ID`. That it is genuinely load-bearing in both places is measured, not assumed: inverting the function turns one test red in the picker's suite and one in the server's. The same shape now covers three rules — `findModel` for catalog membership, `isSharedModel` for the shared fallback, `isModelAvailable` composing them — each with one definition and two callers, which is a different thing from the same rule written twice. (F15)
9. **Two things that looked like work and were measured to be none: a test that could not fail, and a fix that fixed nothing.** The availability test asserted `isModelAvailable(p, m, [])` against `isSharedModel(p, m)` — but with no configured providers the first *reduces* to the second, so it compared a function against itself and would have passed for any implementation. The mutation run is what exposed it: inverting `isSharedModel` left it green while turning its neighbours red. Rewritten to state the rule literally, it now catches. Separately, `<Chat key={conversation.id}>` was added to stop stale model state leaking across a conversation switch — and removing it changed nothing, because Next already remounts the segment on a param change. The first attempt to check that used a full page `goto`, which remounts everything and could never have told the difference; only a client-side sidebar navigation could. The line stays, with a comment saying it pins behaviour rather than fixes a bug. Both belong to one habit: after adding a test or a guard, break the thing it protects and confirm it notices. (F15)
10. **A catalog that only feeds a picker is decoration; this one refuses, and refusing is what gives an empty catalog teeth.** `architecture.md` had said since F02 that `model_id` "must exist in the catalog in `src/lib/models.ts`" — a file that did not exist, guarding a column that accepted any string ≤120 chars. F14 made it real by checking membership in `resolveModel()` and **only** there: not in `chatRequestSchema` as well, because one rule in two files is two rules free to drift, which is exactly what F12 had to unpick in the vault. The check runs *before* the key lookup, since an unknown model cannot succeed and refusing first avoids a database round trip and a decrypt — a mutation moving it below `getDecryptedKey()` turned exactly one test red, which is how that ordering is known to be load-bearing rather than incidental. The consequence lands on `openai` and `anthropic`, which ship as **empty arrays** because no key existed to prove a single id for either: a user with a valid, stored, working OpenAI key still cannot send a message. That is not a bug to route around but the honest state of the product, so `UnknownModelError` builds its message from the catalog and says "PromptX has no OpenAI models available yet" rather than blaming a model id that was never wrong. F15's picker will show both groups empty, which is the right place for it to be visible. (F14)
