import { createServerClient } from '@supabase/ssr'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Cookie } from '@playwright/test'

import type { Database } from '@/types/database'

/**
 * A signed-in browser, without a Google consent screen.
 *
 * Sign-in is Google OAuth only, so no spec can drive the real flow — a headless
 * browser cannot complete a consent screen, and a test account would be Google's
 * bot detection to fight rather than this application's behaviour to prove.
 * `library-docs.md` settles it: seed a user, inject the session.
 *
 * **The cookies are written by `@supabase/ssr` itself, and that is the whole
 * design.** The obvious approach — build `sb-<ref>-auth-token` by hand — means
 * reimplementing a value encoding and a 3180-byte chunking scheme that belong to
 * a pre-1.0 package whose cookie API `architecture.md` already records as having
 * broken across minors. So this runs the real `createServerClient` against an
 * in-memory cookie jar and calls `signInWithPassword`; whatever the library
 * writes into that jar is exactly what the application will read back. The
 * format is never named here, so it cannot drift from the format in use.
 */

type Jar = Map<string, { value: string; options?: Record<string, unknown> }>

export type Actor = {
  id: string
  email: string
  /** A service-role-free client carrying this user's session, for fixtures. */
  client: SupabaseClient<Database>
  /** Ready for `context.addCookies()`. */
  cookies: Cookie[]
}

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is missing; e2e/support/preflight.ts should have caught this`)
  return value
}

const SUPABASE_URL = () => required('NEXT_PUBLIC_SUPABASE_URL')
const PUBLISHABLE_KEY = () => required('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY')
const SECRET_KEY = () => required('SUPABASE_SECRET_KEY')

/**
 * Retries a fixture operation through the one transient this project has met
 * repeatedly: `PGRST303 'JWT issued at future'`.
 *
 * It is clock skew between GoTrue, which mints the token, and PostgREST, which
 * validates it — recorded at F07 and again at F10, and it clears on a retry. A
 * fixture is exactly where it hurts most: it fails in `beforeAll`, so the
 * failure lands on whichever test the runner happened to schedule first and
 * says nothing about the cause. Observed once here taking down the route-census
 * test, which touches no database at all.
 *
 * Bounded and narrow on purpose. Only this code is retried, and only for this
 * error — a blanket retry would turn a real fault into a slow, intermittent one.
 */
export async function retryOnClockSkew<T>(run: () => Promise<T>, attempts = 3): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run()
    } catch (error) {
      const code = (error as { code?: string } | null)?.code
      if (code !== 'PGRST303' || attempt >= attempts) throw error

      await new Promise((resolve) => setTimeout(resolve, 750 * attempt))
    }
  }
}

export function adminClient(): SupabaseClient<Database> {
  return createClient<Database>(SUPABASE_URL(), SECRET_KEY(), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/**
 * Creates a confirmed user and returns it with the cookies a browser needs.
 *
 * One user per spec file, never shared: the quota spec seeds `message_count` to
 * the daily limit, which would wall every other spec, and the key spec's stored
 * key changes which model `resolveModel()` picks for the chat spec. The F03
 * pattern — `auth.admin.createUser` then `signInWithPassword` — for the same
 * reason it was chosen there: only a real JWT exercises grants, policies and
 * PostgREST together.
 */
export async function createActor(label: string): Promise<Actor> {
  const admin = adminClient()
  const email = `e2e-${label}-${crypto.randomUUID()}@promptx.test`
  const password = crypto.randomUUID()

  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })

  if (error || !created.user) {
    throw new Error(`could not create the ${label} user: ${error?.message}`)
  }

  const jar: Jar = new Map()

  // The real SSR client, with a cookie store that happens to be a Map. Nothing
  // here knows the cookie's name, its encoding, or how many chunks it takes.
  const ssr = createServerClient<Database>(SUPABASE_URL(), PUBLISHABLE_KEY(), {
    cookies: {
      getAll() {
        return [...jar.entries()].map(([name, entry]) => ({ name, value: entry.value }))
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          jar.set(name, { value, options: options as Record<string, unknown> })
        }
      },
    },
  })

  const { error: signInError } = await ssr.auth.signInWithPassword({ email, password })
  if (signInError) throw new Error(`could not sign in the ${label} user: ${signInError.message}`)

  if (jar.size === 0) {
    // A silent empty jar would produce a browser that is simply signed out, and
    // every spec would fail on a redirect with nothing pointing here.
    throw new Error(
      'signInWithPassword wrote no cookies. The @supabase/ssr cookie contract has ' +
        'changed; this fixture depends on it writing through setAll.',
    )
  }

  const cookies: Cookie[] = [...jar.entries()].map(([name, entry]) => ({
    name,
    value: entry.value,
    domain: 'localhost',
    path: '/',
    // A session cookie would be dropped by some contexts; an explicit future
    // expiry keeps the browser holding it for the life of the spec.
    expires: Math.floor(Date.now() / 1000) + 60 * 60,
    httpOnly: false,
    secure: false,
    sameSite: 'Lax' as const,
  }))

  // A second client for fixture work inside the spec — seeding a conversation,
  // reading a row back — carrying this user's own session so RLS applies exactly
  // as it does to the browser.
  const client = createClient<Database>(SUPABASE_URL(), PUBLISHABLE_KEY(), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  await client.auth.signInWithPassword({ email, password })

  return { id: created.user.id, email, client, cookies }
}

/**
 * Removes the user, and with it everything that cascades from it.
 *
 * `allSettled` rather than `all`, per F19: on a hosted project with no reset, one
 * rejected delete under `all` discards the other's outcome and silently leaves a
 * real fixture behind.
 */
export async function deleteActors(actors: (Actor | undefined)[]): Promise<void> {
  const admin = adminClient()

  const results = await Promise.allSettled(
    actors
      .filter((actor): actor is Actor => actor !== undefined)
      .map((actor) => admin.auth.admin.deleteUser(actor.id)),
  )

  for (const result of results) {
    if (result.status === 'rejected') {
      console.error('[e2e] could not delete a fixture user', result.reason)
    }
  }
}
