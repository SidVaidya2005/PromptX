# Build Journal

> **Role:** The dated record of how the build got here — one entry per completed feature.
> **Append after every completed feature**; **compact at every phase checkpoint.**
> **Do not read this file at session start.** Open it only to reconstruct one specific feature's history; the rules that still bind live in `constraints.md`.

## How this file is maintained

This file grows for the life of the project and is **not** part of the session
read order. Nothing here is required to make a decision — anything that still
constrains future work gets promoted to `constraints.md`, which is the file
consulted during ordinary work. That separation is what keeps the cost of
knowing "what binds" from growing with the length of the build.

- **Append a dated entry after every completed feature**, under the current phase: decisions made, gotchas hit, verification results.
- **Compact at every phase checkpoint, never continuously.** When a phase closes:
  1. **Promote** anything from that phase that still binds into `constraints.md`, filed under its topic.
  2. **Collapse** the phase's per-feature entries into a handful of summary bullets.
  3. **Drop every `Verified:` line** — it has done its job once the next feature passes.
- Only the current phase keeps full per-feature detail. Earlier phases stay compacted, newest first.

Compaction is recoverable: this file is committed, so `git` history holds every
detail ever removed. Compact confidently.

<!-- Newest phase first. Entry format — repeat per completed feature:

## Phase {{N}} — {{PHASE_NAME}}

### Feature {{NN}} — {{FEATURE_NAME}}  *(YYYY-MM-DD)*
- Decision: …
- Gotcha: …
- Verified: …

At that phase's checkpoint, the whole phase collapses to:

## Phase {{N}} — {{PHASE_NAME}} *(compacted)*
- {{SUMMARY_BULLET}} (F{{NN}}–F{{NN}})

-->

## Phase 4 — Prompt library and search

### 2026-08-08 — 26 Full-text search backend

`messages.search_vector` and `messages_search_idx` have existed since F02 and
nothing had ever queried them. Two migrations —
`20260808024702_search_messages` and its grants — plus `searchMessages()` and an
eleven-test suite over 5,000 seeded messages.

**Two facts were measured against the database before any code was written**,
and both changed the design:

- **`ts_headline` does not escape the document it summarises.** `<script>` was stripped but `<img src=x onerror=alert(2)>` came through verbatim, and fragment selection cut another tag in half leaving `onerror=alert(1)>`. Message content is model output and user input, so a snippet rendered as HTML would execute whatever someone put in a message. `StartSel`/`StopSel` are therefore `chr(2)`/`chr(3)` — verified to survive `ts_headline` and JSON encoding — and F27 splits on them into React elements. §27's "only `<mark>` is permitted" becomes a fact about the data rather than a rule to follow. `library-docs.md`'s snippet is amended in place with the finding.
- **A stopword-only query parses to an empty `tsquery`**, which is detectable in SQL. So `searchMessages()` returns an outcome union and `search_has_terms` distinguishes "try different words" from "nothing here" — asked only when the result set is empty.

**The mutation run found a test that could not fail, and it was not the test I
predicted.** Weakening `messages`'s owner-read policy to `using (true)` left the
whole suite **green**. The reason is structural: `search_messages` inner-joins
`conversations`, whose own owner policy hides the stranger's conversation, so
the row is dropped by the join whichever policy is weakened. Either policy alone
is sufficient here — real defence in depth, but it means no test can single out
the messages policy, and the comment claiming it did was wrong.

Weakening **both** then turned exactly one test red — and it was *"finds nothing
at all for a user with no messages"*, not the isolation test. The isolation
assertion looked for the stranger's wording inside the snippet, and
`ts_headline` returns a **fragment**: the leading words of a short message are
routinely cut, so the substring was absent whether or not the row was there. It
could never have failed. Rewritten to assert on `conversation_title`, which
comes off the row rather than out of the headline, the same mutation turns
**two** tests red. Both policies were restored and verified with
`pg_get_expr(polqual, …)` immediately.

**The performance claim, measured rather than asserted.** §26 asked for a
sub-500ms wall-clock assertion; from this laptop to ap-southeast-1 that measures
the network, so the suite asserts correctness and `EXPLAIN ANALYZE` answers the
speed question. Over 5,001 messages with RLS active:

| query | matches | execution |
| --- | --- | --- |
| `deployment pipeline` (common) | 1,000 | 49.6 ms through the function, 3.4 ms for the body |
| `zylophone` (rare) | 1 | 16.8 ms through the function |

**`messages_search_idx` is not used at this size, and that is correct.** The
planner chose a sequential scan for both the 20%-selectivity term and the
one-row term — the table is ~142 buffers, so scanning it beats a GIN scan plus
heap fetches. Forcing `enable_seqscan = off` made it pick `messages_user_id_idx`
(the RLS column), still not the GIN. So no index was added: the plan says the
one that already exists is not yet earning its keep, which is a better answer
than the composite `btree_gin` index the plan-of-record contemplated.

**Verified:** 348 tests green (26 files), typecheck, lint and a production build
clean. Security advisors show only the two documented intentional notices; no
`function_search_path_mutable`, because both functions set `search_path`. The
deployed definition was checked with `pg_get_functiondef` rather than against
the migration file — it uses `chr(2)` and contains no `<mark>`. Migration
filenames were taken from `list_migrations` *after* applying, which is the
Phase 3 checkpoint's lesson.

**Open after this feature:**

- **A `rollback` inside an `execute_sql` batch rolls back the whole batch**, including statements before the explicit `begin`. An insert-then-measure script silently lost its insert and the next query read `rows=0`, which looked like a broken index. Seed and measure in separate calls.
- **No test isolates the `messages` owner policy for this query.** The inner join means the `conversations` policy covers it too. Not a defect — but if the join is ever removed, the isolation test's discriminating power changes and this should be re-mutated.
- `prompts_tags_idx` is still reported unused, unchanged from F25 and still on purpose.

### 2026-08-08 — 25 Insert a prompt into the composer

A library button in the composer toolbar opening an anchored popover: search
field, keyboard-driven listbox, and insertion of the chosen body at the caret.

**Decisions taken before any code, agreed with the user:**

- **A new `GET /api/prompts`, read on the picker's first open.** F24 predicted this feature would reuse the `/prompts` page's server read and wrote that into the route file; the prediction was wrong and the comment is corrected in place rather than worked around. Reusing the page read would have meant shipping every prompt *body* — up to 10,000 characters each — in the RSC payload of every chat load, for a panel most loads never open.
- **A module-level cache, invalidated inside F24's `usePromptMutation`.** `Chat` remounts per conversation, so component state would have made "once per session" mean "once per conversation".
- **A vendored `popover.tsx`.** A `DropdownMenu` cannot hold a filter input: Radix menus own typing for their typeahead and arrows for item navigation. The popover claims neither, which leaves both to the listbox. No exit keyframe, per F05.
- **The picker's search matches tags; `/prompts` still matches titles only.** Two rules, not two spellings — the page has a tag filter row and the picker has no room for one. Both behaviours are asserted in the same test file so the divergence is visible.

**The Radix finding, which is F21's lesson in a new place.** Insertion worked
first time — right body, right caret, popover closed — and focus was on the
trigger button rather than the textarea. Radix returns focus to the trigger when
a popover closes, and it does so *after* the composer's `requestAnimationFrame`
call, so the composer's focus was set and then taken away. `onCloseAutoFocus` is
the seam, the same one F21 used for the rename input. The yield is **conditional
on an insertion having happened**: closing with Escape or a click outside must
still hand focus back to the trigger, or a keyboard user who changes their mind
is left on `<body>` with nothing to tab from. Both halves measured — insert ends
on the textarea, Escape ends on the trigger.

**`resize()` had to be extracted before any of this worked.** The textarea grew
inside `handleChange`, which is the one path a programmatic `setText` does not
take, so a twelve-line prompt would have landed in a one-row box. Measured after
the fix: 40px → 112px with `scrollHeight === height`.

**The cache was proven by breaking it.** With `invalidatePromptLibrary()`
removed, a prompt created on `/prompts` and a client-side navigation back left
the picker listing four prompts and not the fifth — the row was in the database
and invisible to the panel, which is the staleness the invalidation exists to
prevent. Restored, it appears at the top.

**A harness lesson repeated from F24, having written it down and then done it
again.** `getByRole('link', { name: 'New chat' })` is ambiguous in this sidebar —
there is a "New chat" button *and* a conversation titled "New chat" — and with
stderr suppressed the failed click read as a broken feature for several minutes.
The navigation that works is the PromptX wordmark. Suppressing stderr on a
command whose success is the thing being tested is now two features' worth of
wasted time.

**Mutation runs** (each turned red exactly the tests that claim it, then
restored): dropping the tag arm from `searchPrompts` → the two tag tests, one of
which also asserts `filterPrompts` still *does not* match tags; forcing
`needsLeadingBreak` to false → four separator and caret tests.

**Verified:** 337 tests green (25 files), typecheck, lint and a production build
clean. In the browser: exactly **one** `GET /api/prompts` across three opens and
a conversation switch, and a second only after a write invalidated it; filtering
on `wri` returned two prompts whose titles contain no such string, matching their
`writing` tag; ArrowDown moved `aria-activedescendant` and Enter inserted the
second match; insertion at caret 6 of `before after` produced exactly one leading
newline and no trailing one; a selection was replaced; the picker is disabled
through a real stream (ten consecutive samples showing the stop button and the
disabled trigger) and enabled after; the empty library shows its state and a link
to `/prompts`. Five test rows were deleted from the live project afterwards.

**Open after this feature:**

- **The highlight follows the pointer on open.** If the cursor happens to rest over an option as the panel appears, that option is highlighted and Enter inserts it rather than the top match. Conventional combobox behaviour and not wrong, but a keyboard user who opened by mouse could be surprised. The usual fix is to ignore hover until the mouse actually moves; not built, because it is a papercut rather than a defect.
- **A prompt written in another browser tab is invisible until reload.** Deliberate: the alternative is a poll or a subscription for a panel opened rarely.

### 2026-08-08 — 24 Prompt library

The `prompts` table has existed since F02 and nothing had ever written to it.
This feature gave it CRUD, a page, and the sidebar link that makes the page
reachable at all — plus F23's deferred "Save to library" shortcut.

**Decisions taken before any code, agreed with the user:**

- **No migration.** The table, its four owner policies, `prompts_user_id_idx` and `prompts_tags_idx` all shipped in F02. The one thing F02 did *not* give it is a trigger on `updated_at`, so the update statement writes it.
- **`updated_at` is written on edit**, reversing what four conversation writes do. Same rule read correctly: order on activity, and editing a prompt is the only activity a prompt has. Held by a test that goes red when the column is dropped from the statement.
- **Filtering is client-side over one server read.** No round trip per keystroke, no debounce; F25 wants the same array in client state anyway. F27's message search stays in the URL because it is a ranked query over thousands of rows — different scale, deliberately different mechanism.
- **A sidebar nav block, not another account-menu item.** `project-overview.md` has said since Phase 0 that the sidebar holds Prompts, Search and Settings; the slot is built once and F27/F31 drop into it.
- **`PATCH` takes one strict object, not a union of branches.** The union on `updateConversationSchema` exists because five separate intents converge on one row; a prompt has one intent and the dialog submits all three fields together.
- **Chip tag input with suggestions**, because free text invites `deploy` and `deploys` as two tags that never match. A native `<datalist>` rather than a combobox primitive this codebase does not have — the F22 Dependencies gate.

**The bug the browser found, and the unit suite structurally could not.**
`PromptDialog` seeded its fields inside `handleOpenChange`, the arrangement F23
settled for a dialog that owns its own trigger. It is wrong for a dialog a parent
opens: **Radix calls `onOpenChange` only for changes it initiates** — a trigger,
Escape, the overlay, the close button — and never when a parent flips the `open`
prop. So the handler ran on every close and on no open at all. "New prompt"
opened pre-filled with the last saved prompt, and saving wrote a byte-for-byte
duplicate — same title, same body, same tags. Typecheck, lint and 320 tests were
green throughout. The fix is structural rather than another handler: the library
mounts the dialog only while it is open, so `useState` initialisers do the
seeding and there is no event anyone can forget to fire. Confirmed both ways — a
fresh "New prompt" now opens empty, and Edit opens on the row that was clicked.

A second-order confirmation of the fix: `useId` now returns a different value per
open (`_r_0_` → `_r_c_`), which broke a hardcoded selector mid-session. That is
the remount, visible.

**Two harness mistakes worth recording**, both mine rather than the product's.
Suppressing `2>&1` on `playwright-cli fill` hid a `strict mode violation:
getByLabel('Title') resolved to 2 elements`, so a fill silently did nothing and I
read the resulting duplicate as a data bug for several minutes. And `>> nth=0`
appended to a `getByRole(...)` string is not valid in this CLI — it fails with a
CSS parse error. Drive with refs from the snapshot, and never hide stderr on a
command whose success is the thing being tested.

**Mutation runs** (each turned red exactly the test that claims it, then was
restored):

- Swapping `.overwrite()` and `.max(MAX_PROMPT_TAGS)` in `promptTagsSchema` → only "counts the cap against the deduplicated tags". `.overwrite()` is what makes this orderable at all: unlike `.transform()` it preserves the schema type, so `.max()` can still be chained after it. Read off the installed zod 4.4.3 `.d.cts`, not from memory.
- Dropping `updated_at` from `updatePrompt()` → only "moves updated_at".
- `return data !== null` → `return true` in `deletePrompt()` → both RLS no-op tests, which is the pair that stops the route answering 204 for someone else's prompt.

**Verified:** 320 tests green (25 files), typecheck, lint, and a production build
clean with `/prompts`, `/api/prompts` and `/api/prompts/[id]` registered. In the
browser at 1440/800/360px: the grid is 3/2/1 columns, the sidebar nav is in the
document twice at 360px with exactly one copy visible and **zero duplicate ids
document-wide**, the delete confirmation is a real `alertdialog` with Cancel
focused, search matches titles case-insensitively and does *not* match bodies,
and the tag filter narrows and clears. Tags entered as `  Code  ` and `Writing`
stored as `code` and `writing` — read back from the database, not the screen.
F23's shortcut derived "Be a careful editor." from the first line, saved a real
row, and mounted no second dialog. Card chips render transparent on a hairline
over `canvas-soft`, avoiding the F15/F16 invisible-container trap. Three test
rows were deleted from the live project afterwards.

**Open after this feature:**

- **The `<datalist>` dropdown is not themeable**, so the tag suggestions are the one surface in the app rendering in the browser's own chrome rather than `DESIGN.md`'s palette. A deliberate trade against ~200 lines of listbox; worth a look at F37.
- **`prompts_tags_idx` is still unused**, and now on purpose rather than by omission: filtering happens in the browser, so nothing queries tags in SQL. It becomes correct to drop or to use depending on what F25 needs; not decided here.
- **`use-conversation-mutation.ts` is still misfiled** under `components/sidebar/` — noted at F23 and untouched again, for the same reason.

## Phase 3 — Conversation craft *(compacted)*

Six features, 2026-08-06 to 2026-08-07. The phase turned a thread you could read
into one you can navigate, correct, re-run, name, file away and instruct. It
also added the application's first destructive write, and its first five-branch
request union. Everything still binding is filed in `constraints.md`.

- **The outline rail (F18).** Derived from the already-loaded thread rather than a second query, published through `AppShell` because the rail and the messages are siblings with no prop between them. The rule that looked obviously correct — "the active entry is the last anchor to cross the reading line" — is right going down and wrong going up, and only walking the thread in **both** directions found it; position from `IntersectionObserver` is direction-independent. Two other claims were measured rather than asserted: 1 publish per response with the entries memo against 14 without, and the cleanup effect proven by watching the previous conversation's rail follow the user onto `/settings`.
- **Edit and resend (F19).** The first destructive write, which is why it lives inside `/api/chat` below the "will reach a provider" line — a separate `PATCH` would put the delete on the far side of the refusal path and destroy a thread that was then refused on quota. Shipped as `edit_message_and_truncate`, a plpgsql function, because PostgREST cannot span a transaction. The thread's order became total, `(created_at, id)`, because "everything after this one" needs an exact meaning before anything deletes by it. Three defects surfaced only by checking a different surface than the one that broke: a `.catch()` that could never run, a per-call body silently dropped, and a tie test that passed about half the time.
- **Regenerate (F20).** The SDK supplies its own discriminator — `regenerate()` slices the assistant message out of client state *before* calling the transport — so reading `trigger` off the installed package was the feature. The design changed mid-verification: the first version named the row to replace with the SDK's `messageId`, which is a database id only when the message came from the server, so the second consecutive regeneration sent an invented id and 400'd. The id was dropped entirely rather than repaired, and the same divergence turned out to be live in F19's edit in two separate ways, both fixed here.
- **Rename and pin (F21).** Two thirds of the "logic" already existed — `pinned_at`, the index, the ordering, the grouping — and auto-title suppression was *inherited* from F10's `.eq('title', 'New chat')` guard rather than written, so it got the test that keeps it from being tidied away. The PATCH body became a union of strict branches. Three defects were found only in the browser, all inside one `<input>`: an effect-based focus losing to Radix's trapped FocusScope, Escape reaching Radix's document-capture listener before React and closing the whole drawer, and a `cancelledRef` left set forever because **React fires no blur for an element it unmounts** — which silently ate the next rename's blur commit.
- **Archive (F22).** Mostly assembly on what F02 and F21 had already built: no migration, no new dependency, a fourth strict branch. `Archived` is checked before `Pinned` and archiving never clears the pin, so unarchiving restores a row exactly where it was. The lesson was about reuse: F05's cookie mechanism carried over intact except for the one property nobody had written down — the collapse cookies need no `router.refresh()` because React state mirrors them, while this one decides a *query*, which also forced the layout to read cookies before starting it.
- **Per-conversation system prompt (F23).** A fifth strict branch where **null is a value rather than an absence**, because clearing a prompt and leaving it alone must not be the same request. The field is authoritative on exactly one path — conversation creation, since `/chat` has no row to store one — and inert everywhere else, a distinction held by a single `if`. Proven by behaviour rather than reading: "always reply BANANA" turned "what is the capital of France" into "BANANA", and a crafted `fetch` carrying the same prompt at an existing conversation was answered "Tokyo". The 360px pass caught a regression the feature itself introduced, squeezing the quota meter into four lines in a 58px column.
- **The habit that paid throughout: mutate the guard and watch the right test fail.** Twelve mutations in F21–F23 alone, each turning red exactly one test and leaving its neighbours green, with more in F19 and F20 — and where a check could not be written honestly it was said so rather than faked.

**Open at the close of Phase 3.**

- **Two mutation hooks now reach the same endpoint.** `useModelMutation` has one method and `useConversationMutation` has four, both PATCHing `/api/conversations/[id]` with the same fetch/refresh/error shape. F21's split was justified at the time by error copy; with five branches on the server it now reads as duplication, and one hook with five methods would mirror the route exactly.
- **`use-conversation-mutation.ts` is in the wrong folder.** It lives under `components/sidebar/` and is imported by `components/chat/Composer.tsx`, which `code-standards.md` does not allow for — hooks live beside the component that uses them. It has no home under that rule now that two areas use it, so the rule or the layout needs a decision. Flagged when it happened at F23 and deliberately not folded into that feature.
- **Three exports have no consumers**: `conversationPinSchema`, `conversationArchiveSchema` and the `UpdateConversationInput` type. Harmless, and left uniform with their siblings rather than half-cleaned.
- **The conversation PATCH route is now 236 lines of five near-identical branches.** Each is correct and each was mutation-tested, but the shape repeats — a table of `{key, write, respond}` would say the same thing once. Worth weighing at F24, which adds no branch, or at the next one that does.
- **F23's two verification generations are still in the database** — a "Capital of France" conversation whose only answer is "BANANA", and two messages a crafted fetch added to an existing conversation. Deleting rows is not reversible, so they were reported rather than removed.
- **Four migration files were renamed at this checkpoint to match the ledger.** Their names carried hand-chosen timestamps while `apply_migration` had recorded its own, so a future `supabase migration up` would have seen four unapplied migrations and re-run four bare `create function` statements against a database that already has them. Content byte-identical; only the filenames and four cross-references moved. This is the concrete form of "replayability is untested".
- Carried, unchanged: neither list query is bounded (F06/F08, decide at F37); `openai` and `anthropic` still ship empty catalogs; nothing caps `maxOutputTokens`; a provider's refusal reason still never reaches the user; component behaviour has no automated coverage until F36; `auth_leaked_password_protection` is still disabled (F38); `prompts_tags_idx` is still unused (correct until F24).

## Phase 2 — Bring your own key *(compacted)*

Six features, 2026-08-01 to 2026-08-05. The phase turned a single hardcoded
Gemini path into a multi-provider workspace with other people's credentials in
it: an AES-256-GCM vault, key management, an enforcing model catalog, a picker,
a per-user daily allowance, and a global monthly circuit breaker. It also
introduced the only RLS-bypassing client in the codebase. Everything still
binding is filed in `constraints.md`.

- **The vault (F12).** AES-256-GCM with a fresh 12-byte IV and a verified auth tag, reading its master key through `serverEnv` and validating nothing, because `env.ts` already proved the length at boot. `architecture.md` carried two invariants that could not both hold and a snippet that resolved the tie the wrong way; both were corrected in place. The suite was mutated twice and the second mutation found a test that had been passing by swallowing its own assertion inside its own `catch`.
- **Key management (F13).** Keys are probed before they are kept, with the two failure modes deliberately kept apart and both failing closed. The phase's most dangerous discovery lives here: `bytea` is a hex string over PostgREST, and handing supabase-js a `Buffer` reports **success** while storing `{"type":"Buffer",…}` — corruption that would only surface later, against a real user's credential. Proven by mutation, and the conversion confined to one module. This feature also built `/settings/account`, which no feature in `build-plan.md` owns.
- **The catalog (F14).** `src/lib/models.ts` became an enforcement boundary rather than a list the picker reads, checked in `resolveModel()` and nowhere else, before the key lookup. **Every shipped id was proven by a real generation, not by appearing in a list** — `gemini-2.5-flash` was run as a deliberate control and failed with "no longer available to new users", which is the only thing that makes the passes mean anything. `openai` and `anthropic` ship as empty catalogs because no key existed to prove an id for either. Three claims in the project's own docs turned out to be wrong and were corrected: a Google factory rename that never happened, a two-argument `getDecryptedKey`, and `@ai-sdk/google` being v7 when it is v4.
- **The picker (F15).** What the interface greys out and what the server refuses became one function rather than two spellings, and selection was keyed on `(provider, modelId)` because the same model appears under two providers with different bills. Two things were measured to be nothing: a test that compared a function against itself, and a `key` prop that fixed no bug — the first was rewritten, the second kept with an honest comment, because what depends on it is billing-relevant and fails silently.
- **The daily allowance (F16).** A slot is claimed, never checked, in a single conditional upsert. **The concurrency test `build-plan.md` asked for cannot be written against this project**, and finding that out took a mutation: a deliberately racy read-then-write with a one-second sleep kept the suite green, because requests to the hosted project serialise and no second statement ever lands inside the window. The invariant is held by the implementation's shape — confirmed against the live database with `pg_get_functiondef`, not against the migration file — and the test was kept with an honest name and the measurement in its comment.
- **The circuit breaker (F17).** The second, independent axis, and the first `createServiceRoleClient()`. `estimated_usd` is derived from exact token totals rather than accumulated per call; the availability check is scoped to the current month, because omitting that term is a deadlock reachable by doing nothing. F10's unmeasured titling spend was closed and then *observed* closed: one real message left `message_count = 1` while the ledger held 462 tokens against the message's own 88.
- **A claim written during planning was wrong and the correction is recorded rather than quietly fixed.** F17's rounding argument said a title-sized call rounds to zero in `numeric(10,4)`. Measured in the database before any code was written, it stores as $0.0005 — the real cost is a systematic ~2% downward drift, and the argument that generalises is structural rather than arithmetic. The habit that caught it is the same one this phase relied on throughout: measure the thing rather than reason about it.

**Open at the close of Phase 2.**

- **`openai` and `anthropic` have no models, and no feature owns filling them.** Not a defect — the decision is recorded above — but unassigned work, and visible in the picker as two empty groups. Whoever holds a key for either should list live, prove each id by generating, and add them.
- **Nothing caps `maxOutputTokens`, anywhere.** Providers reserve the model's full ceiling (65,536 on the models tested), which OpenRouter checks against the account balance *before* generating — so a small balance yields a 402 on every request even when actual usage would be trivial. This is why **a successful BYOK generation through the picker has never been demonstrated**; the routing is proven by the failed rows recording the right provider and model. Capping output spans all four providers, so it is a product decision rather than an OpenRouter workaround.
- **A provider's refusal reason never reaches the user.** Every stream failure renders "The model could not finish this response.", so a credit refusal, a rate limit, and a genuine model error are indistinguishable on screen. `code-standards.md` already requires naming the provider without echoing its raw body; the shape exists, the message does not. Decide at F37 with the rest of the error surfaces.
- **Atomicity of `reserve_shared_slot` is unproven by test.** Held by construction and verified structurally against the live function, but no test exercises a real race — the hosted project serialises requests. Two genuinely overlapping sessions need a local stack or F36.
- **The breaker has never tripped from ordinary traffic.** Every trip in testing was seeded, by SQL or by a deliberately oversized token count. The arithmetic is covered and the month-rollover path has now run for real, but nothing has watched spend accumulate to the ceiling over a month.
- **Editing `display_name` is unbuilt and unassigned.** The data model calls the column editable, `/settings/account` renders it read-only, and no feature specifies the path.
- **F17's migration file was edited after `apply_migration` ran**, to correct the rounding claim in its SQL comments. The DDL is byte-identical and the stored `comment on function` text unchanged, so the database matches the file — but the text recorded in `supabase_migrations` is the earlier draft. Harmless, and noted only because replayability is already untested here.
- Carried, unchanged: neither list query is bounded (F06/F08, decide at F37); `auth_leaked_password_protection` is still disabled (decide at F38); component behaviour has no automated coverage until F36; and no migration has been proven to replay from an empty database.

## Phase 1 — Core chat *(compacted)*

Six features, all on 2026-08-01. The phase turned an empty three-column shell
into a working chat: a grouped sidebar, a composer, streaming answers on the
shared Gemini key, rendered markdown with highlighted code, auto-generated
titles, and delete. Everything still binding is filed in `constraints.md`.

- **Sidebar and composer (F06–F07).** The conversation query starts in the layout and arrives at the sidebar as an unawaited promise — a shape the `no-restricted-paths` lint rule forced and that turned out better than the alternative. `POST /api/chat` was given ownership of conversation creation with a nullable `conversationId`, so that F16's quota wall and F17's breaker cannot strand an empty "New chat"; `architecture.md` and `library-docs.md` both carried the non-nullable shape and were corrected. Two things proved load-bearing rather than cosmetic: `touchConversation()`, because nothing triggers `updated_at`, and `router.refresh()`, because the sidebar query lives in a layout Next preserves across navigation.
- **Streaming (F08).** The first end-to-end path. `SHARED_MODEL_ID` had to move to `gemini-3.6-flash` — Google 404s the 2.5 model for new users while still listing it, so the catalog is not proof. Two v7 corrections came from reading the installed `.d.ts` rather than the docs: `onFinish` is a deprecated alias for `onEnd`, and the documented route example passed the model everything *except* the message being answered. `onAbort` was found to carry no partial text at all, silently breaking the invariant that an aborted stream keeps what arrived.
- **Rendering (F09).** Highlighting moved into the browser, against the advice in two of this project's own docs, because the thread is client state and a server-rendered highlight would apply to nothing that stays on screen. Both docs were corrected in place. The language allowlist was reframed as a compatibility guarantee rather than a size one, and a streaming error boundary was found to be worse than useless without a reset.
- **Titles (F10).** Named from the first exchange on a deliberately separate provider entry point, `sharedTitleModel()`, so that F16's reservation cannot be added to the titling path by accident. Two F17 hooks were marked rather than half-built, with the note that the reconciliation sweep cannot cover for the missing one.
- **Delete (F11).** The sidebar row was restructured so a menu button could sit outside the link, and the timestamp and trigger were made to share one slot so the title's width never moves. Three defects surfaced only in a browser — an invisible timestamp swallowing clicks, a click target silently shrinking to the width of the title, and a timestamp hidden on touch by the drawer's own focus trap. None was visible to the type checker, the linter, or a unit test.
- **A wrong explanation was committed and then corrected at this checkpoint.** F11's touch bug was first written up as hover plus CSS source order. Reading the built stylesheet at the checkpoint contradicted it, and a direct measurement found the real cause: Radix's Sheet moves focus onto the first row's overflow trigger, so `:focus-within` matches a row the moment the drawer opens. The constraint was rewritten and narrowed — a pair that both *reveal* has no conflict, and `MessageBubble`'s version was verified correct as written.

**Open at the close of Phase 1.**

- **Neither list query is bounded.** `listConversations()` and `listByConversation()` both fetch every row RLS allows, with no `.limit()`. `MESSAGE_PAGE_SIZE` (50) has existed in `constants.ts` since F01 and is still referenced nowhere. Harmless at present scale and genuinely wrong at a few thousand conversations or a long thread — and F37 sets a budget against a 200-message conversation, which is the page most likely to breach it. Decide there whether to paginate or to accept it with a number attached.
- **Titling spend is unmeasured.** F10 shipped the hooks marked and F17 owns filling them. The reconciliation sweep cannot cover for it — see `constraints.md` → Quota and limits.
- **The mobile drawer puts focus on the first row's overflow trigger.** Correct per the focus trap, but probably not the control a person opening a conversation list wants focused. It is also what made F11's touch bug possible. Worth revisiting in F37's accessibility pass.
- **Component behaviour still has no automated coverage.** Unchanged since F05 and true until F36: `vitest.config.ts` matches `tests/**/*.test.ts` in a node environment, so every UI claim in this phase rests on a browser session, not a suite. The three defects F11 found — all invisible to typecheck, lint, and unit tests — are the argument for F36 rather than a reason to distrust the phase.
- Carried from Phase 0, unchanged: `auth_leaked_password_protection` is still disabled (decide at F38), `prompts_tags_idx` is still unused (correct until F24), and no migration has been proven to replay from an empty database (true until a local stack exists).

## Phase 0 — Foundation *(compacted)*

Five features, all on 2026-07-31. Versions landed: Next 16.2.12, React 19.2.4,
Tailwind v4.3.3, TypeScript 5.9.3, zod 4.4.3, Vitest 4.1.10, `@supabase/ssr`
0.12.4, `@supabase/supabase-js` 2.111.0, pnpm 11.18.0 on Node 26.5.0. Supabase
project `promptx` / `kplbxqujihxzdltrwxbw`, `ap-southeast-1`, Postgres 17.6,
five recorded migrations. Everything still binding from this phase is filed in
`constraints.md`.

- **Scaffold and design tokens (F01).** The whole `DESIGN.md` `@theme` block, three `next/font` faces, five shadcn primitives retuned in place, Prettier + ESLint flat config, and the boundary invariants turned into lint rules while the tree was still empty. Four silent failures were found and closed here, every one of which compiled, linted and typechecked cleanly: the font tokens not reaching `next/font`, the spacing tokens shadowing Tailwind's container scale (`max-w-4xl` = 64px), `cn()` dropping custom type steps, and `server-only` throwing under Vitest. A doc claim was corrected too — a cleared breakpoint emits *nothing* rather than failing to compile, so the protection is real but the failure mode is silence.
- **Schema and scheduled jobs (F02).** Eight tables, three enums, the generated `search_vector` and its GIN index, the `handle_new_user` trigger, and both `pg_cron` jobs — verified as actually *running* in `cron.job_run_details`, not merely scheduled. Hosted-only was chosen deliberately (no Docker on this machine), trading away `supabase db reset` and with it any proof that a migration replays from zero. RLS was enabled here rather than in F03 so no table sat world-readable in between.
- **RLS policies (F03).** 27 owner policies across seven tables, the two `anon` share policies pulled forward from F33, a private `attachments` bucket, and a 16-test isolation suite. The suite was itself tested by weakening a policy to `using (true)` and confirming exactly two tests went red — a suite that has never failed is indistinguishable from one that asserts nothing.
- **Google Sign-In (F04).** The full loop against a real Google account, the real landing page, `src/proxy.ts`, and `tests/auth/auth-config.test.ts` pinning four dashboard settings that have no diff and no history. F03's closing instruction to disable signups was found to be wrong on both counts and corrected in place rather than quietly dropped. The open-redirect guard moved to a unit-tested `safeRedirectPath()`, which immediately surfaced a second bypass (`/\evil.example`) the inline version had missed.
- **Application shell (F05).** The three-column frame, an edge-anchored `Sheet` for the mobile drawer and outline sheet, the account menu, the first `error.tsx`/`loading.tsx`/`not-found.tsx` in the repo, and `src/server/data/profiles.ts` — the first module in that folder, a feature earlier than planned, because the `.from()` lint rule is exempted there and nowhere else. Collapse state moved from the plan's `localStorage` to a cookie so the Server Component paints the collapsed state directly. An exit animation was found to strand the panel on screen after Escape and was removed; `UserAvatar` was switched off lazy loading. The mobile layout, carried as *Not verified* by both F01 and F04 because the browser window would not resize, was finally verified at 360/767/768/1023/1024/1920 by loading the app in a sized same-origin iframe — media queries evaluate against the iframe's own viewport, which sidesteps the resize problem entirely. Worth reusing at F37.

**Open at the close of Phase 0.**

- **`auth_leaked_password_protection` is disabled** — a new WARN from `get_advisors security` that F03 did not see. Low impact here, since no real user ever sets a password (Google OAuth only; the email provider exists solely so F03's suite can `signInWithPassword` against admin-created users). Enabling it is a dashboard change and was left alone rather than made silently. Worth deciding at F38.
- **`prompts_tags_idx` is still an unused index.** Correct — nothing queries it until F24.
- **No migration has been proven to replay from an empty database.** Unchanged since F02, and it stays true until a local stack exists.
