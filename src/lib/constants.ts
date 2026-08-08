/**
 * Every limit, threshold, and fixed identifier in the application. A number
 * that appears inline at a call site is a defect.
 *
 * This file is importable from Client Components, so it holds PUBLIC
 * configuration only. It must never read ENCRYPTION_KEY, SUPABASE_SECRET_KEY,
 * or SHARED_GEMINI_API_KEY — those live in src/server/env.ts.
 */

import type { Provider } from '@/types/domain'

/**
 * Reads a NEXT_PUBLIC_ variable, failing loudly rather than shipping `undefined`.
 *
 * These are inlined at BUILD time, so a build without them bakes `undefined`
 * into the client bundle and the failure surfaces as an unexplained runtime
 * error in the browser. Throwing here turns that into a failed build, which is
 * the same "fail at boot, not at first request" posture src/server/env.ts takes
 * for secrets.
 *
 * The `process.env.NEXT_PUBLIC_*` member expressions must appear literally at
 * the call sites below — Next substitutes the literal, not a variable holding
 * the name.
 */
function requiredPublicEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `${name} is not set. Copy .env.example to .env.local and fill it in; ` +
        'NEXT_PUBLIC_ variables are inlined at build time, so this must be ' +
        'present before `pnpm build`, not just before the first request.',
    )
  }

  return value
}

/** Public by design. The publishable key is safe to expose — RLS is the protection. */
export const SUPABASE_URL = requiredPublicEnv(
  'NEXT_PUBLIC_SUPABASE_URL',
  process.env.NEXT_PUBLIC_SUPABASE_URL,
)

export const SUPABASE_PUBLISHABLE_KEY = requiredPublicEnv(
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
)

/**
 * The base every OAuth redirect and share link is built from.
 *
 * Deliberately used instead of the request's own origin. Render terminates TLS
 * at a proxy, so `new URL(request.url).origin` inside a route handler can be the
 * internal address rather than the address the browser knows — which produces a
 * redirect that either 404s or silently drops the session cookie.
 */
export const SITE_URL = requiredPublicEnv(
  'NEXT_PUBLIC_SITE_URL',
  process.env.NEXT_PUBLIC_SITE_URL,
)

/**
 * The model served by the shared key. Nothing else is available without a
 * personal key.
 *
 * Pinned to a version rather than the `gemini-flash-latest` alias, which also
 * works. This key is billed, and feature 17 derives `estimated_usd` from a
 * Flash rate card — an alias that silently moves to a differently-priced model
 * makes that ledger wrong with nothing on screen to say so.
 *
 * `gemini-2.5-flash` was the original choice and had to be replaced: Google
 * returns 404 "no longer available to new users" for it, while still listing it
 * from the models endpoint. Verify a replacement with a real generateContent
 * call, not by reading the catalog.
 */
export const SHARED_MODEL_ID = 'gemini-3.6-flash' as const

/**
 * How each provider is named in the interface.
 *
 * Keyed by the Postgres enum so adding a provider to the enum without naming it
 * here is a type error rather than a blank row. Feature 14 considered folding
 * this into `src/lib/models.ts` and did not: the catalog is keyed by provider
 * and would have to carry the label on every entry, or once in a shape that is
 * this map by another name. It stays the one place a provider has a human name.
 */
export const PROVIDER_LABELS: Record<Provider, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  openrouter: 'OpenRouter',
}

/**
 * Bounds on a submitted provider key, before it is probed.
 *
 * A cheap shape check, not validation — the probe is what decides whether a key
 * is real. The cap exists because an unbounded string on a public route is a
 * denial-of-service vector; the floor rejects an obviously empty paste without
 * a network round trip.
 */
export const PROVIDER_KEY_MIN_LENGTH = 20
export const PROVIDER_KEY_MAX_LENGTH = 300

/** Optional user-supplied name for a stored key. */
export const PROVIDER_KEY_LABEL_MAX_LENGTH = 60

/**
 * Hard ceiling on the pre-storage probe of a provider key.
 *
 * Deliberately not STREAM_TIMEOUT_MS. Two minutes is the right bound for a
 * stream someone is watching arrive; for a HEAD-shaped liveness check that a
 * person is actively waiting on, holding the request that long is just a form
 * of hanging. Exceeding this is reported as "could not verify", never as
 * "your key is wrong".
 */
export const KEY_PROBE_TIMEOUT_MS = 10 * 1000

/**
 * Per-user shared-key allowance, resetting at 00:00 UTC.
 *
 * NEXT_PUBLIC_ is load-bearing rather than cosmetic. Next inlines only
 * NEXT_PUBLIC_* into client bundles, so an unprefixed read here would be
 * `undefined` in the composer and silently fall back to 20 while the server
 * enforced the real number. The value is not a secret — the cap is displayed
 * in the UI by design. The tradeoff is that it is inlined at BUILD time, so
 * changing it on Render needs a rebuild, not a restart.
 */
export const SHARED_KEY_DAILY_MESSAGE_LIMIT = Number(
  process.env.NEXT_PUBLIC_SHARED_KEY_DAILY_MESSAGE_LIMIT ?? 20,
)

/** Global monthly ceiling. Breaching it trips the circuit breaker for every user. */
export const SHARED_KEY_MONTHLY_USD_CEILING = Number(
  process.env.NEXT_PUBLIC_SHARED_KEY_MONTHLY_USD_CEILING ?? 10,
)

/**
 * The rate card for SHARED_MODEL_ID, in US dollars per million tokens.
 *
 * Read from https://ai.google.dev/gemini-api/docs/pricing on 2026-08-05 —
 * $1.50 input, $7.50 output for Gemini 3.6 Flash, paid tier. Not written from
 * memory: CLAUDE.md's authority order puts the vendor's own page above anything
 * recalled, and a wrong figure here does not fail, it silently mis-prices the
 * ledger a circuit breaker is read off.
 *
 * Deliberately NOT a NEXT_PUBLIC_ variable, unlike the two limits above. No
 * browser needs these — the figure is never displayed, only accumulated
 * server-side — so there is nothing to inline and nothing to keep in step
 * across a rebuild.
 *
 * This pairs with SHARED_MODEL_ID being pinned to a version rather than an
 * alias. An alias that moved to differently-priced weights would leave these
 * numbers describing a model that is no longer the one being billed, with
 * nothing on screen to say so. Re-check both together.
 */
export const SHARED_KEY_INPUT_USD_PER_MILLION = 1.5
export const SHARED_KEY_OUTPUT_USD_PER_MILLION = 7.5

/** Show the quota warning in the composer at this many remaining messages. */
export const QUOTA_WARNING_THRESHOLD = 5

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024

/** Enforced server-side when the message is sent, not only in the composer. */
export const MAX_ATTACHMENTS_PER_MESSAGE = 4

/** Orphaned uploads older than this are reaped by the hourly pg_cron job. */
export const ATTACHMENT_ORPHAN_TTL_HOURS = 24

/** nanoid length for share slugs. ~71 bits — unguessable by enumeration. */
export const SHARE_SLUG_LENGTH = 12

/** Retries on a unique violation before the share request fails. Never unbounded. */
export const SHARE_SLUG_MAX_RETRIES = 3

export const ALLOWED_ATTACHMENT_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/pdf',
] as const

/**
 * Hard ceiling on a single provider call, enforced with an AbortSignal.
 * Render allows a 100-minute request, so the platform will not rescue us from
 * a hung upstream — this is the only thing that ends a stalled stream.
 */
export const STREAM_TIMEOUT_MS = 2 * 60 * 1000

/** Messages fetched per page when a thread is long enough to paginate. */
export const MESSAGE_PAGE_SIZE = 50

export const SEARCH_RESULT_LIMIT = 30

/**
 * How `search_messages` marks a matched term inside a snippet. (F26)
 *
 * **Not `<mark>`, and the difference is a security boundary rather than a
 * styling choice.** `ts_headline` does not escape the document it summarises —
 * measured against this project before the function was written, an
 * `<img src=x onerror=alert(2)>` in a message came through the headline intact,
 * and fragment selection cut another tag in half. Message content is model
 * output and user input, so a snippet rendered as HTML would execute whatever
 * someone put in a message.
 *
 * STX and ETX cannot occur in prose, survive JSON encoding, and mean nothing to
 * a browser. F27 splits on them and emits real React elements, so no consumer
 * ever holds a string it might be tempted to pass to `dangerouslySetInnerHTML`.
 *
 * These two values are duplicated in `20260808024702_search_messages.sql` as
 * `chr(2)` and `chr(3)`, which is the one place they could drift. A test asserts
 * the snippet actually comes back wrapped in them.
 */
export const SEARCH_MATCH_START = '\u0002'
export const SEARCH_MATCH_END = '\u0003'

/** Conversation title generated from the first exchange, capped for the sidebar. */
export const MAX_TITLE_LENGTH = 60

/**
 * The title every conversation starts with, matching the column default in
 * `20260731065201_enums_and_tables.sql`.
 *
 * Named here because auto-titling gates on it: a conversation is titled only
 * while its title is still this string. That one comparison is also what stops
 * feature 21's manual rename from being overwritten — a renamed conversation is
 * no longer 'New chat', so the generator skips it without needing a column to
 * record the fact.
 */
export const DEFAULT_CONVERSATION_TITLE = 'New chat'

/**
 * Ceiling on a per-conversation system prompt. (F23)
 *
 * Matches the figure `architecture.md` records against the column and the one
 * `build-plan.md` §23 specifies, rather than being derived from any provider's
 * context window — a prompt this long is already a design problem, and the cap
 * is here to bound the request body, not to fit a particular model.
 *
 * Measured after trimming, which is the only reading that makes a pasted prompt
 * with trailing whitespace behave the way its author expects.
 */
export const MAX_SYSTEM_PROMPT_LENGTH = 10_000

/**
 * How much of a system prompt the composer shows before ellipsising.
 *
 * Small on purpose: the control sits beside the model picker on one line at
 * 360px, and its job is to say *that* there is a prompt and roughly what it is
 * about. Reading it is what the dialog is for.
 */
export const SYSTEM_PROMPT_PREVIEW_LENGTH = 40

/**
 * Hard ceiling on the title generation call.
 *
 * Deliberately not STREAM_TIMEOUT_MS. Two minutes is the right bound for an
 * answer someone is reading as it arrives; for six words nobody is waiting on,
 * it just holds a connection open. Titling is best-effort — giving up early
 * costs a title, and the conversation keeps 'New chat'.
 */
export const TITLE_TIMEOUT_MS = 15 * 1000

/**
 * How much of each side of the first exchange is sent to the titling model.
 *
 * The shared key is billed, so feeding a 5,000-token code answer through it to
 * produce a six-word title is money spent on tokens that cannot change the
 * result — a response states its subject in its opening lines, not its last.
 */
export const TITLE_SOURCE_CHAR_LIMIT = 500

/**
 * Bounds on one saved prompt in the library. (F24)
 *
 * The body cap matches MAX_SYSTEM_PROMPT_LENGTH rather than being chosen
 * independently, because the two are frequently the same string: F23's dialog
 * can save its standing instruction straight into the library, and a library
 * that accepted something the system-prompt field would then refuse would be a
 * trap laid one feature apart.
 *
 * The title is longer than MAX_TITLE_LENGTH's 60. That figure is sized for a
 * 260px sidebar row; a prompt title lives on a card in a grid and is the only
 * thing the search box matches against, so squeezing it buys nothing.
 */
export const MAX_PROMPT_TITLE_LENGTH = 100
export const MAX_PROMPT_BODY_LENGTH = 10_000

/**
 * Bounds on a prompt's tags.
 *
 * A cap on the count as well as the length, because `tags` is a `text[]` and an
 * unbounded array is the same denial-of-service vector an unbounded string is —
 * the cap on each element does not bound the whole.
 */
export const MAX_PROMPT_TAGS = 8
export const MAX_PROMPT_TAG_LENGTH = 24

/**
 * How much of a prompt's body a card renders.
 *
 * `line-clamp-3` decides what is *seen*; this decides what is *rendered*, the
 * distinction OUTLINE_ENTRY_CHAR_LIMIT records. A body may be 10,000 characters
 * and the grid holds every prompt the user owns, so clamping only in CSS would
 * put the whole library into the DOM to show three lines of each.
 */
export const PROMPT_BODY_PREVIEW_LENGTH = 220

/**
 * How many user prompts a conversation needs before the outline rail appears.
 *
 * An exchange is one prompt, so the rail arrives when the third is *sent* rather
 * than when its answer completes — waiting for the answer would make sending a
 * message do nothing visible for a while, which reads as lag rather than as a
 * rule. Below this the whole right column is unmounted, gutter and mobile
 * trigger included: a restore button that restores nothing is worse than no
 * button.
 */
export const OUTLINE_MIN_EXCHANGES = 3

/**
 * How much of a prompt an outline entry carries.
 *
 * `line-clamp-2` decides what is *seen*; this decides what is *rendered*. A user
 * message can be a 10,000-character paste, and below 1024px the rail exists
 * twice — the desktop aside is `display:none` but still in the document while
 * the sheet copy is mounted. Clamping only in CSS would put that paste into the
 * DOM twice to show two lines of it.
 */
export const OUTLINE_ENTRY_CHAR_LIMIT = 140

/** How long a jumped-to message stays highlighted before settling back. */
export const OUTLINE_HIGHLIGHT_MS = 1200

/**
 * Where the shell's collapse preferences live.
 *
 * A cookie rather than localStorage, and the difference is visible. The (app)
 * layout is a Server Component, so it can read a cookie during render and emit
 * the collapsed markup in the first paint. localStorage is unreadable until
 * after hydration, which means the server would always render the sidebar
 * expanded and the client would then correct it — a flash on every single
 * navigation, for exactly the users who asked for it to be closed.
 *
 * Written from the client with `document.cookie`; no route handler is involved,
 * because nothing on the server needs to act on the value beyond rendering it.
 */
export const SIDEBAR_COOKIE = 'px_sidebar'
export const RAIL_COOKIE = 'px_rail'

/**
 * The two cookie values. Only COLLAPSED is tested for — anything else, including
 * a missing cookie, reads as expanded, so a first-time visitor gets the full
 * three-column shell without needing a cookie to have been written first.
 */
export const COLLAPSED = 'collapsed'
export const EXPANDED = 'expanded'

/** One year. A layout preference has no reason to expire mid-session. */
export const COLLAPSE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

/**
 * Whether the sidebar reveals archived conversations. (F22)
 *
 * Same mechanism as the two above and one important difference: those cookies
 * only decide *markup*, and the client already holds the same state, so their
 * server re-render is cosmetic. This one decides which **query** the layout
 * runs — `listConversations(includeArchived)` — so writing it must be followed
 * by `router.refresh()` or the list on screen answers the old question.
 *
 * Only SHOW_ARCHIVED is tested for, so a missing cookie hides archived rows.
 * That is the right default in the safe direction: a value nobody has written
 * yet cannot reveal something the user filed away.
 */
export const ARCHIVED_COOKIE = 'px_archived'
export const SHOW_ARCHIVED = 'shown'
