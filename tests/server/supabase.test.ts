import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Three clients with three different privilege levels, and the differences
 * between them are the security model rather than configuration detail.
 *
 * - the cookie-bound client carries the caller's session, so PostgREST resolves
 *   the role to `authenticated` and the owner policies apply
 * - the anon client carries the same publishable key and NO session, so the role
 *   is `anon` and only the three share policies apply
 * - the service-role client carries the secret key and bypasses RLS entirely
 *
 * Each of those follows from an argument passed to a factory, which is exactly
 * the kind of thing that is invisible in review and silent when wrong. F33 is
 * the precedent: reading a share link through the cookie-bound client returned
 * nothing for any signed-in visitor, the query succeeded, and the page 404'd as
 * though the slug were wrong.
 *
 * The SDK factories are mocked so the arguments can be read. Nothing here needs
 * a database — what is under test is which key and which session policy each
 * client is built with.
 */

/**
 * The factories are typed by signature rather than inferred from a zero-argument
 * implementation, so `mock.calls` is a tuple with elements in it. Inferred, the
 * calls type is `[]` and reading argument 1 or 2 — which is the entire subject
 * of this file — does not typecheck.
 */
type FactoryArgs = [url: string, key: string, options?: Record<string, unknown>]

type CookieStore = {
  getAll: () => { name: string; value: string }[]
  set: (name: string, value: string, options?: unknown) => void
}

const createClient = vi.fn<(...args: FactoryArgs) => { kind: string }>(() => ({
  kind: 'plain',
}))

const createServerClient = vi.fn<(...args: FactoryArgs) => { kind: string }>(() => ({
  kind: 'ssr',
}))

const cookies = vi.fn<() => Promise<CookieStore>>(async () => ({
  getAll: () => [{ name: 'sb-access-token', value: 'token' }],
  set: () => {},
}))

vi.mock('@supabase/supabase-js', () => ({ createClient }))
vi.mock('@supabase/ssr', () => ({ createServerClient }))
vi.mock('next/headers', () => ({ cookies }))

const PUBLIC_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
  NEXT_PUBLIC_SITE_URL: 'https://promptx.test',
}

const SECRET_ENV = {
  SUPABASE_SECRET_KEY: 'sb_secret_test',
  ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  SHARED_GEMINI_API_KEY: 'test-gemini-key',
}

type Supabase = typeof import('@/server/supabase')

async function loadSupabase(): Promise<Supabase> {
  for (const [name, value] of Object.entries({ ...PUBLIC_ENV, ...SECRET_ENV })) {
    vi.stubEnv(name, value)
  }

  return import('@/server/supabase')
}

beforeEach(() => {
  vi.resetModules()
  createClient.mockClear()
  createServerClient.mockClear()
  cookies.mockClear()
})

describe('createAnonSupabaseClient', () => {
  it('carries the publishable key and never the secret one', async () => {
    const { createAnonSupabaseClient } = await loadSupabase()

    createAnonSupabaseClient()

    const [url, key] = createClient.mock.calls[0] ?? []
    expect(url).toBe(PUBLIC_ENV.NEXT_PUBLIC_SUPABASE_URL)
    expect(key).toBe(PUBLIC_ENV.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
    expect(key).not.toBe(SECRET_ENV.SUPABASE_SECRET_KEY)
  })

  it('reads no cookie, which is what makes every visitor anonymous', async () => {
    // The F33 defect in one assertion. A client that picked up the caller's
    // session would resolve to `authenticated`, and the anon share policies —
    // which are `for select to anon` — would stop applying, so a signed-in
    // visitor opening a colleague's link would silently get nothing back.
    const { createAnonSupabaseClient } = await loadSupabase()

    createAnonSupabaseClient()

    expect(cookies).not.toHaveBeenCalled()
    expect(createClient.mock.calls[0]?.[2]).not.toHaveProperty('cookies')
  })

  it('persists no session, because there is no user here to have one', async () => {
    const { createAnonSupabaseClient } = await loadSupabase()

    createAnonSupabaseClient()

    expect(createClient.mock.calls[0]?.[2]).toMatchObject({
      auth: { persistSession: false, autoRefreshToken: false },
    })
  })
})

describe('createServiceRoleClient', () => {
  it('carries the secret key, which is what bypasses RLS', async () => {
    const { createServiceRoleClient } = await loadSupabase()

    createServiceRoleClient()

    expect(createClient.mock.calls[0]?.[1]).toBe(SECRET_ENV.SUPABASE_SECRET_KEY)
  })

  it('reads the secret through serverEnv rather than process.env at the call site', async () => {
    // env.ts validates the whole secret environment at boot, which is what makes
    // a missing key a boot failure rather than a failure at the first request
    // that needs it. A direct `process.env` read here would skip that.
    const { createServiceRoleClient } = await loadSupabase()
    vi.stubEnv('SUPABASE_SECRET_KEY', 'sb_secret_changed_after_boot')

    createServiceRoleClient()

    expect(createClient.mock.calls[0]?.[1]).toBe('sb_secret_test')
  })

  it('persists no session', async () => {
    const { createServiceRoleClient } = await loadSupabase()

    createServiceRoleClient()

    expect(createClient.mock.calls[0]?.[2]).toMatchObject({
      auth: { persistSession: false, autoRefreshToken: false },
    })
  })
})

describe('createServerSupabaseClient', () => {
  it('carries the publishable key and the request’s cookies', async () => {
    const { createServerSupabaseClient } = await loadSupabase()

    await createServerSupabaseClient()

    const [url, key, options] = createServerClient.mock.calls[0] ?? []
    expect(url).toBe(PUBLIC_ENV.NEXT_PUBLIC_SUPABASE_URL)
    expect(key).toBe(PUBLIC_ENV.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
    expect(options).toHaveProperty('cookies')
    expect(cookies).toHaveBeenCalledOnce()
  })

  it('hands the SDK the cookies it was given', async () => {
    const { createServerSupabaseClient } = await loadSupabase()

    await createServerSupabaseClient()

    const options = createServerClient.mock.calls[0]?.[2] as {
      cookies: { getAll: () => { name: string }[] }
    }

    expect(options.cookies.getAll()).toEqual([
      { name: 'sb-access-token', value: 'token' },
    ])
  })

  it('swallows a write to a read-only cookie store rather than failing the render', async () => {
    // Server Components get a read-only store and `set` throws there. Letting it
    // propagate would break every page that reads user data; it is safe to
    // swallow only because src/proxy.ts writes the rotated cookies instead.
    cookies.mockResolvedValueOnce({
      getAll: () => [],
      set: () => {
        throw new Error('Cookies can only be modified in a Server Action')
      },
    })

    const { createServerSupabaseClient } = await loadSupabase()
    await createServerSupabaseClient()

    const options = createServerClient.mock.calls[0]?.[2] as {
      cookies: { setAll: (next: unknown[]) => void }
    }

    expect(() =>
      options.cookies.setAll([{ name: 'sb-access-token', value: 'new', options: {} }]),
    ).not.toThrow()
  })

  it('is built fresh per call, so one request’s session cannot serve the next', async () => {
    const { createServerSupabaseClient } = await loadSupabase()

    await createServerSupabaseClient()
    await createServerSupabaseClient()

    expect(createServerClient).toHaveBeenCalledTimes(2)
    expect(cookies).toHaveBeenCalledTimes(2)
  })
})
