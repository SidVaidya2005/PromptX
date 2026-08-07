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
**Last completed:** 23 Per-conversation system prompt — 280 tests (15 new), typecheck, lint and a production build green. The PATCH union took a fifth `.strict()` branch, and this one differs from the other four: **null is a value, not an absence** — it is how a prompt is cleared, so an absent key and an explicit null had to mean different things. The schema collapses empty and whitespace-only to null, `.trim()` first, so null is the single spelling of "no prompt" and the route can send `system: undefined` rather than handing a provider an empty string. **Proven end to end rather than asserted:** with the prompt set to "always reply BANANA", asking for the capital of France returned BANANA — and a crafted `fetch` carrying that same prompt in the body of an existing conversation returned Tokyo, which is the override guard holding. Four mutations each turned red exactly one test. The 360px pass caught a regression this feature introduced: adding a third control squeezed the quota meter to 58px, where it rendered as four lines in a column, so the toolbar group now wraps — measured before and after, and desktop is unchanged at one 32px line
**Next:** Phase 3 checkpoint — run the verification commands, inspect the phase diff for bugs and regressions, confirm code consistency across F18–F23, update this file, compact `build-journal.md` by promoting Phase 3's still-binding decisions into `constraints.md`, and record any follow-up work

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
- [x] 22 Archive
- [x] 23 Per-conversation system prompt
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

1. **A field that only *sometimes* means anything is a guard, not a field, and the guard is one line with nothing holding it in place.** F23 let the composer send `systemPrompt` in every chat request, because on `/chat` there is no row yet and the body is the only way a prompt chosen before the first message can reach the server. That makes the field authoritative on exactly one path — conversation creation — and inert on every other, and the entire difference is one `if` in the route. Honour it anywhere else and it stops being "the conversation's standing instruction" and becomes a per-request override: one answer generated under rules the conversation does not record, with nothing on screen or in the database to say so. Since nothing structural enforces that, it was proven by behaviour instead of by reading — a crafted `fetch` carrying "always reply BANANA" against an existing conversation was answered "Tokyo", and the same string set properly through the control turned "what is the capital of France" into "BANANA". Two shared-key messages, and worth both: the observable question is not whether a column was written but **which string reached the provider**, and only a generation answers that. The related rule this reinforces: null and absent must be allowed to differ. Clearing a prompt is `{systemPrompt: null}`; leaving it alone is the key not being there — collapse those two and removing an instruction silently leaves it in force. (F23)
2. **A cookie that decides markup and a cookie that decides a query are not the same mechanism, and the difference only shows up as a stale list.** F05 established that shell layout state is a cookie — read by the Server Component, written with one line of `document.cookie`, no route handler, and notably **no** `router.refresh()`, because the collapse state is also held in React state and the server re-render is cosmetic. F22 reused the mechanism for "show archived" and inherited an assumption that does not hold: this cookie is an input to `listConversations(includeArchived)`, so without a refresh the button flips, the cookie changes, and the sidebar underneath keeps answering the previous question until something unrelated happens to re-render it. It also forced the `(app)` layout to `await cookies()` *before* starting the conversation query rather than beside it — the query cannot be issued until it knows what to ask for — which costs nothing (cookies() reads the request, not the network) but does undo the shape of an optimisation that had a comment explaining it. The general rule: **when reusing a mechanism, check which of its properties were load-bearing for the original use and which were incidental.** The cookie, the max-age and the samesite flag carried over intact; "nothing needs to re-fetch" was the one that did not, and it was the one nothing wrote down. Related and cheaper to state: F22 also let one F21 test fail on purpose, because it had used `{archived: true}` as its example of an intent the PATCH union did not carry — a test whose fixture is "a thing we do not support yet" has an expiry date built into it. (F22)
3. **A rename input is three separate fights with the layer underneath it, and the unit suite could not have seen any of them.** F21's schema and data functions were proven by mutation and green on the first run; the feature was still broken three times over in the browser, all inside one `<input>`. Focusing it from an effect lost to Radix's trapped FocusScope — the input rendered with the right value while `document.activeElement` was `BODY` — so the focus moved to `onCloseAutoFocus`, the seam Radix provides for exactly this. Escape reached Radix before React did, because a Sheet dismisses from `document.addEventListener('keydown', …, { capture: true })`, which runs before the root listener React attaches: `stopPropagation()` in a React handler is already too late, and cancelling a rename at 360px closed the whole sidebar. The listener moved to `window`, one step above `document` in the capture path. And a cancelled rename left `cancelledRef` set forever — **React fires no blur for an element it unmounts** — so the *next* rename on that row silently discarded its own blur commit, keeping the typed title on screen while the database never heard about it. Each was found by driving the real thing and reading the database back, and each fix came from reading the installed package rather than reasoning about it. The rule this leaves: **when a component sits inside a library's focus or dismissal scope, that library's listeners are part of the component's control flow** — find out which phase and which target they use before assuming an event is yours to handle. The corollary is about refs: a flag cleared only on the event that consumes it stays set when that event never fires, so clear it where the interaction *starts*. (F21)
4. **A client cannot reliably name a database row, and the design that assumed it could passed every test before failing on the second click.** F20's first version identified the answer being replaced with the `messageId` the AI SDK hands `prepareSendMessagesRequest` — free, already there, obviously correct. It is a database uuid only when the message came from the server. A message that has just *streamed* carries an id the SDK generated, so the first regeneration worked and the next sent `a6i8GltgJ1K7KZtE` and was refused as a malformed uuid. Nothing in the suite could have caught it: every unit test constructs its own body, and the divergence only exists in a browser that has streamed once and not navigated. What made it survivable is that the id was never load-bearing — the route already required the target to be the *last* message, read from the database, so the id could only agree or disagree with something already known. It was dropped rather than repaired, and a `regenerate: true` flag says the same thing without pretending to identify a row. The general rule this leaves: **before sending an identifier, ask which side minted it.** Client-minted ids are for reconciling client state; only server-minted ids may name server state. The same divergence turned out to be live in F19's `editMessageId` in two separate ways, and both were fixed here rather than left: editing a message *sent* in the same session (the client id was invented from birth), and editing one *twice* (`sendMessage` pushed a new id while the database updated the original row in place). The fixes are a transient `data-prompt-message` part the client adopts in `onFinish`, and `sendMessage`'s own `messageId` option, which replaces a message keeping its id. Each was removed in turn and broke exactly one of the two cases. What made all of this hard to see is that a reload cures it, and a new conversation never shows it at all — `router.replace()` remounts `Chat` with database ids while `router.refresh()` does not. (F20)
5. **Three defects that compiled, linted, typechecked and looked correct, and the only thing that found any of them was checking a different surface than the one they broke.** F19's client called `sendMessage(...).catch(restore)` to put a thread back after a refused edit — the SDK's `makeRequest` catches, calls `onError`, and sets `status: 'error'` rather than rejecting, so that `.catch` could never run once. `prepareSendMessagesRequest` built its body from scratch and discarded the per-call `body` it is handed, so `editMessageId` never reached the server at all: the client truncated its view, the server appended, and **the screen looked perfect** — the database is what disagreed, and only after a reload. And a tie test written to guard the truncation order was flaky, because `(created_at, id)` breaks a tie on a random uuid and the fixture let the ids fall where they may; it passed about half the time and would have read as infrastructure noise rather than as a result. Each was caught by a different move: reading the installed `.d.ts` instead of trusting a promise-shaped API, querying the database instead of screenshotting the thread, and running a mutation that happened to fail the wrong test twice. The general rule is narrower than "test more" — **verify on the surface the code actually writes to, not the one that shows the outcome.** (F19)
6. **The rule that is right in one direction is the one to distrust, and scrolling has two directions.** The outline's active entry was first written as "the last anchor to cross the reading line", which reads as obviously correct and is — going down. Going up it is wrong in a way no amount of staring at it reveals: scrolling back past a prompt leaves that prompt as the most recent crossing while the reader is now above it, so the marker sticks to an exchange that has been left. The fix was to stop recording what an anchor *did* and record where it *is* — `IntersectionObserver` reports both, and position is direction-independent. Caught before shipping only because the browser pass walked the thread **both ways** rather than confirming the direction the feature was designed around: down held one prompt from scrollTop 400 to 2000 through a long answer, and up walked 3→2→1→0. The same session measured the other two claims instead of asserting them — the entries memo at 1 publish per streamed response against 14 without it, and the publish effect's cleanup by removing it and watching the previous conversation's rail follow the user onto `/settings`. A verification pass that only exercises the case the code was written for is a demonstration, not a test. (F18)
7. **A job with 800 consecutive successes had never once done its job, and only a deliberate orphan could tell the difference.** `reconcile_shared_key_usage()` has run on `pg_cron` every ten minutes since F02 shipped it on 2026-07-31 — `cron.job_run_details` is at runid 866 and shows an unbroken wall of green, which meant only that it executed, against a database that had no reservations to correct until F16 and no orphan since. `build-plan.md` §17 asked for a test that it releases a stale orphan and leaves a live one alone; F17 shipped without building it, and the checkpoint is where that was caught. The four tests written here are the first thing to watch the sweep act: it drops a stale counter to zero, leaves a fresh one at 3, declines to raise 0 to 1 when a delivered message outruns the reservation, and retires a `streaming` row abandoned mid-stream. Both mutations then showed what the guards are worth in the currency that matters — removing the staleness clause **zeroed a live reservation**, and removing `message_count > actual` **billed a user for a generation the reserve path had already missed**. A scheduled job is not verified by its exit status; it is verified by giving it something to fix and watching it fix that. (Phase 2 checkpoint)
8. **A derived column and an accumulated one are not the same ledger, and the cheaper-looking option undercounts.** `estimated_usd` could have been a running sum of per-call dollar deltas; instead it is recomputed from the exact `bigint` token totals on every write. The arithmetic was measured rather than guessed, and the first guess was wrong in an instructive way: a title-sized call is $0.00051, which does **not** vanish in a `numeric(10,4)` column as predicted — it stores as $0.0005. What it does is drift, always downward, so ten titles come to $0.0050 against a true $0.0051, and a mutation swapping derive for accumulate turned exactly that test red with exactly those figures. The stronger argument is structural and is the one that generalises: an accumulated dollar column is a second independent record of a fact the token columns already hold, free to disagree with them forever with nothing to notice — the same shape as F12's two-places validation and F15's two spellings of one rule. Derive from the exact thing; never keep a rounded copy alongside it. (F17)
9. **A test can be impossible to write, and the only way to find out is to break the thing it guards.** `build-plan.md` §16 asked for a concurrency test: ten simultaneous reservations at the boundary yielding exactly one success. It was written, it passed, and it was worthless. Replacing `reserve_shared_slot`'s single conditional upsert with a read-then-write — the exact implementation the guard exists to forbid — left it **green**; so did widening the race to a full second with `pg_sleep` between the read and the write, which must over-issue under any real overlap. Timing gave the reason: ten calls each sleeping a second took eleven seconds, and three further rounds of six parallel calls took ~6.8s apiece. Requests to the hosted project serialise, through a signed-in client, a header-only client, and a raw `fetch` alike, so no second statement ever lands inside the window. An early six-in-1.7s reading suggested otherwise and turned out to be a first-burst artifact that would not reproduce. The invariant is still held — `reserve_shared_slot` is a **single SQL statement**, structurally incapable of read-then-write, confirmed against the live database with `pg_get_functiondef` rather than against the migration file — but it is held by construction, not by the suite. The test was kept with an honest name and the measurement in its comment. The general rule: a green test is a claim, and the only evidence for it is watching it fail on purpose. (F16)
10. **A rule two runtimes both have to know gets one definition, not two spellings of it.** The picker greys out what a user cannot send to; `resolveModel()` refuses the same thing on the server. Written independently those are two expressions of one rule, and their disagreement is invisible in both directions — a picker offering a model every send then rejects, or hiding one that would have worked. So "what the shared key serves" became `isSharedModel()` in `src/lib/models.ts`, and `resolveModel()` was rewritten to call it rather than keep its own `provider !== 'google' || modelId !== SHARED_MODEL_ID`. That it is genuinely load-bearing in both places is measured, not assumed: inverting the function turns one test red in the picker's suite and one in the server's. The same shape now covers three rules — `findModel` for catalog membership, `isSharedModel` for the shared fallback, `isModelAvailable` composing them — each with one definition and two callers, which is a different thing from the same rule written twice. (F15)
