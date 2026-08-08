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

**Phase:** Phase 4 — Prompt library and search, in progress
**Last completed:** 27 Search interface — `/search` over `?q=`, results grouped by conversation without disturbing F26's ranking, ⌘K from anywhere, and a `?m=` deep link that reuses F18's `jumpTo`. Two gaps F18 left surfaced only now that search returns *assistant* messages: they had no scroll anchor at all, and no highlight — both fixed, the highlight as a left indicator rather than a border, because DESIGN.md is explicit that a response carries no chrome. The security claim was verified end to end in a browser: a message containing `<img src=x onerror=alert(1)>` renders as text with zero real `<img>` elements on the page. 360 tests, typecheck, lint and a production build green. **Phase 4's feature work is complete — the phase checkpoint is next.**
**Previously completed:** 26 Full-text search backend — `search_messages` and `search_has_terms`, over a `search_vector` and GIN index that had sat unqueried since F02. Two facts were measured before any code: `ts_headline` does not escape the document it summarises, so snippets use control-character sentinels rather than `<mark>` and are plain text by construction; and a stopword-only query parses to an empty `tsquery`, so "no searchable terms" is a distinct answer from "no matches". §26's sub-500ms wall-clock assertion was replaced with `EXPLAIN ANALYZE` — 3.4–49.6ms over 5,001 rows, and the GIN index is correctly *not* used at this size, so no index was added. 348 tests, typecheck, lint and a production build green; advisors show only the documented notices

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
- [x] Phase checkpoint — verify Phase 3 — Conversation craft is stable before starting the next phase

### Phase 4 — Prompt library and search

- [x] 24 Prompt library
- [x] 25 Insert a prompt into the composer
- [x] 26 Full-text search backend
- [x] 27 Search interface
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

1. **A capability built for one caller quietly encodes that caller's assumptions, and the second caller is what exposes them.** F18 gave messages scroll anchors and a jump highlight, and both worked perfectly for two features — because the only thing jumping was the outline rail, which lists *prompts*. F27 pointed search at the same machinery and found it half-built: `AssistantMessage` had no anchor at all, so half of every result set would have navigated to the right conversation and left the reader at the top of a sixty-message thread with nothing marking the match; and `isHighlighted` was never passed to it either, so even landing correctly said nothing about which message was meant. Neither was a bug in F18 — its own caller never needed them — and neither failed any test, because the gap is an absence rather than a fault. What found them was reading the code the new caller would use *before* wiring it up, and asking what a result pointing at an answer would actually do. The fix carried its own lesson: the obvious move was to copy `UserMessage`'s `border-primary`, and DESIGN.md forbids it outright — `message-assistant` says a response carries no fill and no border, "the content, not a card" — so the highlight became the 2px left indicator `outline-rail-item` already uses, with a transparent border always present so highlighting cannot reflow the thread. **Reusing a mechanism means auditing it against the new caller's cases, not just calling it**; and when a component refuses the obvious styling, the design system usually already names what to do instead. Third time in three features that a browser locator collided under strict mode — the habit that works is refs from `snapshot`, not hand-composed CSS. (F27)
2. **A test can be green because something *else* is protecting the thing it claims to test — and the mutation that shows you is not the one you predicted.** F26's isolation test asserted that a search never returns another user's message. Weakening the `messages` owner policy to `using (true)` left the entire suite green, because `search_messages` inner-joins `conversations` and *that* table's policy hides the row instead: either policy alone is sufficient, so no test of this query can single out either one. Real defence in depth, and a comment claiming the messages policy was "the only thing scoping this" that was simply false. Weakening **both** then turned exactly one test red, and it was the wrong one — *"finds nothing for a user with no messages"*, not the isolation test, which still could not fail. Its assertion searched the *snippet* for the stranger's wording, and `ts_headline` returns a **fragment**: the opening words of a short message are routinely cut, so the substring was absent whether or not the row was present. Rewritten to assert on `conversation_title`, which comes off the row rather than out of the headline, the same mutation turns two tests red. Three rules. **A green suite under a broken guard means the guard you broke was not the one doing the work** — find out which one is, and say so, rather than assuming the nearest one. **Never assert on a value the database is free to reformat**: a snippet, a headline, a rendered date and a truncated preview are all derived, and an assertion against one of them fails to fail. And the F03 habit needs a corollary now that policies are being weakened on a *live* project — restore in the very next call and verify with `pg_get_expr`, never at the end of a batch of experiments. Separately, and cheaply learned: a `rollback` inside an `execute_sql` batch rolls back the whole batch, including the insert before the explicit `begin`, which made a seeded row vanish and read as a broken index. (F26)
3. **The second half of a library's focus behaviour is the half that runs after yours.** F24 found that Radix never calls `onOpenChange` for a parent-driven open; F25 found the mirror image one layer along, in the same primitive family. Inserting a prompt worked on the first try — right body, right caret, panel closed — and focus was sitting on the trigger button rather than in the textarea, because Radix restores focus to the trigger when a popover closes and does it *after* the `requestAnimationFrame` the composer used to place its own caret. Both calls ran; the last one won; nothing anywhere reported a problem. `onCloseAutoFocus` is the seam, which is the third time this project has ended up there — F21 used it for the rename input and the constraint has said since then that a Radix menu traps focus until it has finished closing. What is new is that the yield had to be **conditional**: preventing the restore unconditionally would fix insertion and break Escape, leaving a keyboard user who changed their mind on `<body>` with nothing to tab from. So the flag says *why* the panel is closing, and only the path with somewhere better to send focus takes it. Two rules. **When a library and your code both move focus, the question is not whether yours runs but whether it runs last** — and the way to find out is to read `document.activeElement` after the interaction rather than to look at the screen, which showed the correct text in the correct place throughout. And **a fix that changes a shared exit path has to be checked on every way in**: insert, Escape, and click-outside are three closes, and the first version was right about one of them. The same session repeated F24's harness mistake despite having written it down — a suppressed `strict mode violation` on an ambiguous "New chat" locator read as a broken feature for several minutes, in a sidebar that contains both a New chat button and a conversation named "New chat". (F25)
4. **A library only calls the handler for the changes *it* initiates, and the one it never calls for is the one the component was counting on.** `PromptDialog` seeded its fields inside `onOpenChange`, copied from F23's `SystemPromptControl`, where it is correct — that dialog owns its own trigger, so every open *is* Radix-initiated. This one is opened by a parent flipping the `open` prop, and Radix does not call `onOpenChange` for that. The handler therefore ran on every close and on no open at all. Nothing failed: typecheck, lint and 320 tests stayed green, and the symptom only appears on the *second* use in one page session — "New prompt" opened holding the previously saved prompt, and saving wrote a byte-for-byte duplicate, same title, same body, same tags. The fix is not a better handler but the removal of the need for one: the library mounts the dialog only while it is open, so `useState` initialisers do the seeding and it cannot be skipped. The remount is observable — `useId` returns a new value per open, which broke a hardcoded selector mid-session and was the confirmation. Two rules this leaves. **A pattern copied from a working component carries the conditions that made it work**, and "who initiates the state change" is one nobody writes down: F23's seeding, F21's `onCloseAutoFocus`, and F18's publish effect are all correct in their own component and none of them transplants unexamined. And **prefer the arrangement that makes the mistake unrepresentable** over the one that requires an event to fire — the same move as F16's atomic claim and F10's `sharedTitleModel()` taking no user id. Two harness lessons came with it, both self-inflicted: suppressing stderr on `playwright-cli fill` hid a `strict mode violation` and turned a silently-failed fill into several minutes of hunting a data bug that did not exist. (F24)
5. **A field that only *sometimes* means anything is a guard, not a field, and the guard is one line with nothing holding it in place.** F23 let the composer send `systemPrompt` in every chat request, because on `/chat` there is no row yet and the body is the only way a prompt chosen before the first message can reach the server. That makes the field authoritative on exactly one path — conversation creation — and inert on every other, and the entire difference is one `if` in the route. Honour it anywhere else and it stops being "the conversation's standing instruction" and becomes a per-request override: one answer generated under rules the conversation does not record, with nothing on screen or in the database to say so. Since nothing structural enforces that, it was proven by behaviour instead of by reading — a crafted `fetch` carrying "always reply BANANA" against an existing conversation was answered "Tokyo", and the same string set properly through the control turned "what is the capital of France" into "BANANA". Two shared-key messages, and worth both: the observable question is not whether a column was written but **which string reached the provider**, and only a generation answers that. The related rule this reinforces: null and absent must be allowed to differ. Clearing a prompt is `{systemPrompt: null}`; leaving it alone is the key not being there — collapse those two and removing an instruction silently leaves it in force. (F23)
6. **A cookie that decides markup and a cookie that decides a query are not the same mechanism, and the difference only shows up as a stale list.** F05 established that shell layout state is a cookie — read by the Server Component, written with one line of `document.cookie`, no route handler, and notably **no** `router.refresh()`, because the collapse state is also held in React state and the server re-render is cosmetic. F22 reused the mechanism for "show archived" and inherited an assumption that does not hold: this cookie is an input to `listConversations(includeArchived)`, so without a refresh the button flips, the cookie changes, and the sidebar underneath keeps answering the previous question until something unrelated happens to re-render it. It also forced the `(app)` layout to `await cookies()` *before* starting the conversation query rather than beside it — the query cannot be issued until it knows what to ask for — which costs nothing (cookies() reads the request, not the network) but does undo the shape of an optimisation that had a comment explaining it. The general rule: **when reusing a mechanism, check which of its properties were load-bearing for the original use and which were incidental.** The cookie, the max-age and the samesite flag carried over intact; "nothing needs to re-fetch" was the one that did not, and it was the one nothing wrote down. Related and cheaper to state: F22 also let one F21 test fail on purpose, because it had used `{archived: true}` as its example of an intent the PATCH union did not carry — a test whose fixture is "a thing we do not support yet" has an expiry date built into it. (F22)
7. **A rename input is three separate fights with the layer underneath it, and the unit suite could not have seen any of them.** F21's schema and data functions were proven by mutation and green on the first run; the feature was still broken three times over in the browser, all inside one `<input>`. Focusing it from an effect lost to Radix's trapped FocusScope — the input rendered with the right value while `document.activeElement` was `BODY` — so the focus moved to `onCloseAutoFocus`, the seam Radix provides for exactly this. Escape reached Radix before React did, because a Sheet dismisses from `document.addEventListener('keydown', …, { capture: true })`, which runs before the root listener React attaches: `stopPropagation()` in a React handler is already too late, and cancelling a rename at 360px closed the whole sidebar. The listener moved to `window`, one step above `document` in the capture path. And a cancelled rename left `cancelledRef` set forever — **React fires no blur for an element it unmounts** — so the *next* rename on that row silently discarded its own blur commit, keeping the typed title on screen while the database never heard about it. Each was found by driving the real thing and reading the database back, and each fix came from reading the installed package rather than reasoning about it. The rule this leaves: **when a component sits inside a library's focus or dismissal scope, that library's listeners are part of the component's control flow** — find out which phase and which target they use before assuming an event is yours to handle. The corollary is about refs: a flag cleared only on the event that consumes it stays set when that event never fires, so clear it where the interaction *starts*. (F21)
8. **A client cannot reliably name a database row, and the design that assumed it could passed every test before failing on the second click.** F20's first version identified the answer being replaced with the `messageId` the AI SDK hands `prepareSendMessagesRequest` — free, already there, obviously correct. It is a database uuid only when the message came from the server. A message that has just *streamed* carries an id the SDK generated, so the first regeneration worked and the next sent `a6i8GltgJ1K7KZtE` and was refused as a malformed uuid. Nothing in the suite could have caught it: every unit test constructs its own body, and the divergence only exists in a browser that has streamed once and not navigated. What made it survivable is that the id was never load-bearing — the route already required the target to be the *last* message, read from the database, so the id could only agree or disagree with something already known. It was dropped rather than repaired, and a `regenerate: true` flag says the same thing without pretending to identify a row. The general rule this leaves: **before sending an identifier, ask which side minted it.** Client-minted ids are for reconciling client state; only server-minted ids may name server state. The same divergence turned out to be live in F19's `editMessageId` in two separate ways, and both were fixed here rather than left: editing a message *sent* in the same session (the client id was invented from birth), and editing one *twice* (`sendMessage` pushed a new id while the database updated the original row in place). The fixes are a transient `data-prompt-message` part the client adopts in `onFinish`, and `sendMessage`'s own `messageId` option, which replaces a message keeping its id. Each was removed in turn and broke exactly one of the two cases. What made all of this hard to see is that a reload cures it, and a new conversation never shows it at all — `router.replace()` remounts `Chat` with database ids while `router.refresh()` does not. (F20)
9. **Three defects that compiled, linted, typechecked and looked correct, and the only thing that found any of them was checking a different surface than the one they broke.** F19's client called `sendMessage(...).catch(restore)` to put a thread back after a refused edit — the SDK's `makeRequest` catches, calls `onError`, and sets `status: 'error'` rather than rejecting, so that `.catch` could never run once. `prepareSendMessagesRequest` built its body from scratch and discarded the per-call `body` it is handed, so `editMessageId` never reached the server at all: the client truncated its view, the server appended, and **the screen looked perfect** — the database is what disagreed, and only after a reload. And a tie test written to guard the truncation order was flaky, because `(created_at, id)` breaks a tie on a random uuid and the fixture let the ids fall where they may; it passed about half the time and would have read as infrastructure noise rather than as a result. Each was caught by a different move: reading the installed `.d.ts` instead of trusting a promise-shaped API, querying the database instead of screenshotting the thread, and running a mutation that happened to fail the wrong test twice. The general rule is narrower than "test more" — **verify on the surface the code actually writes to, not the one that shows the outcome.** (F19)
10. **The rule that is right in one direction is the one to distrust, and scrolling has two directions.** The outline's active entry was first written as "the last anchor to cross the reading line", which reads as obviously correct and is — going down. Going up it is wrong in a way no amount of staring at it reveals: scrolling back past a prompt leaves that prompt as the most recent crossing while the reader is now above it, so the marker sticks to an exchange that has been left. The fix was to stop recording what an anchor *did* and record where it *is* — `IntersectionObserver` reports both, and position is direction-independent. Caught before shipping only because the browser pass walked the thread **both ways** rather than confirming the direction the feature was designed around: down held one prompt from scrollTop 400 to 2000 through a long answer, and up walked 3→2→1→0. The same session measured the other two claims instead of asserting them — the entries memo at 1 publish per streamed response against 14 without it, and the publish effect's cleanup by removing it and watching the previous conversation's rail follow the user onto `/settings`. A verification pass that only exercises the case the code was written for is a demonstration, not a test. (F18)
