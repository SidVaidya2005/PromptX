import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The session guard both halves of the application call before anything else:
 * `(app)/layout.tsx` and every route handler, independently, because
 * `src/proxy.ts` refreshes the session and is never the authorisation check.
 *
 * What is asserted here is the branching and — more importantly — *which* auth
 * call it makes. `getSession()` reads unverified cookie data a client could have
 * forged; `getUser()` validates the JWT against the auth server. The difference
 * is invisible in every passing case and is the whole security property, so it
 * gets its own test rather than being left to a comment.
 *
 * Mocked rather than hosted: this module's subject is control flow over an SDK
 * response, and a real session would prove Supabase works rather than that these
 * fourteen lines do.
 */

const REDIRECTED = new Error('NEXT_REDIRECT')

const getUserResponse = vi.fn()
const redirect = vi.fn(() => {
  // The real `redirect()` throws to unwind the render, and callers rely on
  // nothing after it running. A mock that merely records the call would let
  // `requireUser` fall through and return `data.user` — which is null on exactly
  // the paths this file exists to check.
  throw REDIRECTED
})

vi.mock('next/navigation', () => ({ redirect }))

vi.mock('@/server/supabase', () => ({
  createServerSupabaseClient: async () => ({
    auth: {
      getUser: getUserResponse,
      getSession: () => {
        throw new Error(
          'getSession() reads unverified cookie data and must never gate access',
        )
      },
    },
  }),
}))

type Auth = typeof import('@/server/auth')

async function loadAuth(): Promise<Auth> {
  return import('@/server/auth')
}

const USER = { id: '00000000-0000-4000-8000-000000000001' }

beforeEach(() => {
  vi.resetModules()
  getUserResponse.mockReset()
  redirect.mockClear()
})

describe('requireUser', () => {
  it('returns the signed-in user', async () => {
    getUserResponse.mockResolvedValue({ data: { user: USER }, error: null })

    const { requireUser } = await loadAuth()

    expect(await requireUser()).toEqual(USER)
    expect(redirect).not.toHaveBeenCalled()
  })

  it('redirects to the landing page when the token does not validate', async () => {
    getUserResponse.mockResolvedValue({
      data: { user: null },
      error: { message: 'invalid JWT' },
    })

    const { requireUser } = await loadAuth()

    await expect(requireUser()).rejects.toThrow(REDIRECTED)
    expect(redirect).toHaveBeenCalledWith('/')
  })

  it('redirects when there is no user and no error, which is the signed-out case', async () => {
    // Supabase reports a missing session as a null user rather than as an error,
    // so a guard checking only `error` would return null and let an anonymous
    // visitor through with `User` as its declared type.
    getUserResponse.mockResolvedValue({ data: { user: null }, error: null })

    const { requireUser } = await loadAuth()

    await expect(requireUser()).rejects.toThrow(REDIRECTED)
    expect(redirect).toHaveBeenCalledWith('/')
  })
})

describe('getUser', () => {
  it('returns the signed-in user', async () => {
    getUserResponse.mockResolvedValue({ data: { user: USER }, error: null })

    const { getUser } = await loadAuth()

    expect(await getUser()).toEqual(USER)
  })

  it('returns null rather than redirecting, so a route handler can answer 401', async () => {
    getUserResponse.mockResolvedValue({ data: { user: null }, error: null })

    const { getUser } = await loadAuth()

    expect(await getUser()).toBeNull()
    expect(redirect).not.toHaveBeenCalled()
  })
})

describe('which auth call the guards make', () => {
  it('validates the token rather than reading the cookie, on both paths', async () => {
    // The mocked client throws from getSession(), so reaching for it fails the
    // test by name instead of silently returning a forgeable session.
    getUserResponse.mockResolvedValue({ data: { user: USER }, error: null })

    const { getUser, requireUser } = await loadAuth()

    await expect(requireUser()).resolves.toEqual(USER)
    await expect(getUser()).resolves.toEqual(USER)
    expect(getUserResponse).toHaveBeenCalledTimes(2)
  })
})
