/**
 * Every limit, threshold, and fixed identifier in the application. A number
 * that appears inline at a call site is a defect.
 *
 * This file is importable from Client Components, so it holds PUBLIC
 * configuration only. It must never read ENCRYPTION_KEY, SUPABASE_SECRET_KEY,
 * or SHARED_GEMINI_API_KEY — those live in src/server/env.ts.
 */

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

/** The model served by the shared key. Nothing else is available without a personal key. */
export const SHARED_MODEL_ID = 'gemini-2.5-flash' as const

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

/** Conversation title generated from the first exchange, capped for the sidebar. */
export const MAX_TITLE_LENGTH = 60
