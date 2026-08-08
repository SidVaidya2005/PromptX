import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The map from a typed error to the status and code a client branches on.
 *
 * Every route that resolves a model funnels its refusals through this one
 * function, so the four arms below are the whole 4xx/5xx contract of the chat,
 * compare and title paths. Nothing else in the codebase decides that a missing
 * key is a 400 and a tripped breaker is a 503.
 *
 * Three of the distinctions carry real weight:
 *
 * - **429 and 503 mean different things and must not be collapsed.** A daily
 *   allowance running out is the user's own quota; a tripped breaker is the
 *   whole shared key being unavailable to everybody. F17 goes out of its way to
 *   check the breaker BEFORE claiming a slot so that a global outage is never
 *   reported as somebody's personal allowance running out — and that care is
 *   wasted if both arrive as the same status.
 * - **`unknown_model` returns the error's OWN message**, unlike the arms around
 *   it, because it already distinguishes "no such model" from "PromptX ships
 *   none for this provider yet" — the empty-catalog case F14 shipped for OpenAI
 *   and Anthropic. Rebuilding that sentence here would put one rule in two
 *   files, which is the mistake F12 had to unpick in the vault.
 * - **an unrecognised error returns null**, so the caller falls through to a
 *   generic 500 rather than this function inventing a status for something it
 *   does not understand.
 */

const VALID_ENV = {
  SUPABASE_SECRET_KEY: 'sb_secret_test_value',
  ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  SHARED_GEMINI_API_KEY: 'test-gemini-key',
  NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
  NEXT_PUBLIC_SITE_URL: 'https://test.promptx.local',
}

type Providers = typeof import('@/server/providers')
type Quota = typeof import('@/server/quota')

async function load(): Promise<{ providers: Providers; quota: Quota }> {
  for (const [name, value] of Object.entries(VALID_ENV)) vi.stubEnv(name, value)

  // Mocked for the reason every suite reaching src/server/ has to: importing
  // these modules otherwise reaches cookies() from next/headers, which throws
  // outside a request scope.
  vi.doMock('@/server/keys', () => ({ getDecryptedKey: vi.fn() }))
  vi.doMock('@/server/supabase', () => ({
    createServerSupabaseClient: vi.fn(),
    createServiceRoleClient: vi.fn(),
  }))

  return {
    providers: await import('@/server/providers'),
    quota: await import('@/server/quota'),
  }
}

beforeEach(() => {
  vi.resetModules()
})

describe('modelErrorPayload', () => {
  it('turns a missing key into a 400 naming the provider', async () => {
    const { providers } = await load()

    const payload = providers.modelErrorPayload(new providers.MissingKeyError('anthropic'))

    expect(payload?.status).toBe(400)
    expect(payload?.body.code).toBe('missing_key')
    expect(payload?.body.error).toContain('anthropic')
  })

  it('turns a tripped breaker into a 503, never a 429', async () => {
    // The global outage. Reporting it as 429 would tell a user their own
    // allowance ran out, and send them to a wall that is not theirs.
    const { providers, quota } = await load()

    const payload = providers.modelErrorPayload(new quota.BudgetExhaustedError())

    expect(payload?.status).toBe(503)
    expect(payload?.body.code).toBe('budget_exhausted')
  })

  it('turns a spent daily allowance into a 429, never a 503', async () => {
    const { providers, quota } = await load()

    const payload = providers.modelErrorPayload(new quota.QuotaExceededError())

    expect(payload?.status).toBe(429)
    expect(payload?.body.code).toBe('quota_exceeded')
  })

  it('keeps the two apart, which is the whole reason F17 checks the breaker first', async () => {
    const { providers, quota } = await load()

    const breaker = providers.modelErrorPayload(new quota.BudgetExhaustedError())
    const allowance = providers.modelErrorPayload(new quota.QuotaExceededError())

    expect(breaker?.status).not.toBe(allowance?.status)
    expect(breaker?.body.code).not.toBe(allowance?.body.code)
  })

  it('passes an unknown model’s own message through, empty catalog and all', async () => {
    // The catalog ships no OpenAI models, so the honest refusal names that
    // rather than blaming a model id that was never wrong. (F14)
    const { providers } = await load()

    const error = new providers.UnknownModelError('openai', 'gpt-5')
    const payload = providers.modelErrorPayload(error)

    expect(payload?.status).toBe(400)
    expect(payload?.body.code).toBe('unknown_model')
    expect(payload?.body.error).toBe(error.message)
  })

  it('returns null for anything it does not recognise, so the caller answers 500', async () => {
    // Never invent a status for an error this function does not understand: a
    // database fault dressed as a 400 tells the client to stop retrying
    // something that would have worked.
    const { providers } = await load()

    expect(providers.modelErrorPayload(new Error('connection reset'))).toBeNull()
    expect(providers.modelErrorPayload('a string')).toBeNull()
    expect(providers.modelErrorPayload(null)).toBeNull()
  })
})
