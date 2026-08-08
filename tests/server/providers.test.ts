import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SHARED_MODEL_ID } from '@/lib/constants'
import { MODEL_CATALOG } from '@/lib/models'

/**
 * resolveModel is the single place that decides which key answers a request, so
 * what is asserted here is its branching and the ORDER of it — not whether any
 * provider SDK works. Instantiating a model allocates an object and makes no
 * network call, so the real factories are used; no test in this project may
 * spend money.
 *
 * `@/server/keys` and `@/server/quota` are both mocked rather than the vault or
 * the database beneath them. The subject is which branch runs, and mocking
 * deeper would mean building sealed fixtures and usage rows to prove something
 * this file does not claim. Neither is optional: importing providers.ts reaches
 * getDecryptedKey → getSealedKey → createServerSupabaseClient → cookies() and
 * reserveSharedSlot → the same, both of which throw outside a request scope.
 *
 * Whether the reservation itself is correct is `tests/server/quota.test.ts`,
 * against a real database with a real session — atomicity is a property of
 * Postgres and a mock cannot have it.
 *
 * The whole secret environment is stubbed and the module imported fresh, because
 * providers.ts reads serverEnv at load. Same reason as tests/server/keys.test.ts,
 * and it keeps this suite runnable on a machine that has never held a real key.
 */

const VALID_ENV = {
  SUPABASE_SECRET_KEY: 'sb_secret_test_value',
  ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  SHARED_GEMINI_API_KEY: 'test-gemini-key',
  NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
  NEXT_PUBLIC_SITE_URL: 'https://test.promptx.local',
}

const USER_ID = '00000000-0000-4000-8000-000000000001'

/** Obviously not a real key, and long enough to look like one. */
const TEST_KEY = 'sk-test-0000000000000000abcd'

/** A catalog Google model that is NOT the one the shared key serves. */
const OTHER_GOOGLE_MODEL = 'gemini-3.5-flash'

type Providers = typeof import('@/server/providers')

const getDecryptedKey = vi.fn<() => Promise<string | null>>()
const reserveSharedSlot = vi.fn<() => Promise<number>>()

/**
 * Loads providers.ts with the caller's stored key stubbed to `key`.
 *
 * `vi.doMock` rather than `vi.mock` is deliberate: it is not hoisted, so it
 * registers in call order, before the dynamic import below picks it up. A
 * hoisted `vi.mock` would run above the env stubbing and defeat both.
 */
function loadProviders(key: string | null): Promise<Providers> {
  for (const [name, value] of Object.entries(VALID_ENV)) {
    vi.stubEnv(name, value)
  }

  getDecryptedKey.mockResolvedValue(key)
  vi.doMock('@/server/keys', () => ({ getDecryptedKey }))
  vi.doMock('@/server/quota', () => ({ reserveSharedSlot }))

  return import('@/server/providers')
}

beforeEach(() => {
  vi.resetModules()
  getDecryptedKey.mockReset()
  reserveSharedSlot.mockReset()
  reserveSharedSlot.mockResolvedValue(1)
})

describe('resolveModel — the catalog as a boundary', () => {
  it('refuses a model that is not in the catalog', async () => {
    const { resolveModel, UnknownModelError } = await loadProviders(TEST_KEY)

    await expect(resolveModel(USER_ID, 'google', 'gemini-3-ultra')).rejects.toBeInstanceOf(
      UnknownModelError,
    )
  })

  it('refuses before it ever reads a key', async () => {
    // Ordering, not politeness. An unknown model cannot succeed, so refusing it
    // first saves a database round trip and a decrypt — and keeps a decrypted
    // key from existing at all for a request that was never going anywhere.
    const { resolveModel } = await loadProviders(TEST_KEY)

    await expect(resolveModel(USER_ID, 'google', 'gemini-3-ultra')).rejects.toThrow()
    expect(getDecryptedKey).not.toHaveBeenCalled()
  })

  it('refuses every model for a provider it ships none for, even with a valid key', async () => {
    // The accepted consequence of shipping openai and anthropic empty: a real,
    // stored, working key still cannot send a message. Pinned so it stays a
    // decision on record rather than something rediscovered in the browser.
    const { resolveModel, UnknownModelError } = await loadProviders(TEST_KEY)

    expect(MODEL_CATALOG.openai).toHaveLength(0)
    await expect(resolveModel(USER_ID, 'openai', 'gpt-5.6-luna')).rejects.toBeInstanceOf(
      UnknownModelError,
    )
  })

  it('blames the empty catalog rather than the model id when it ships none', async () => {
    // Someone who just added a working key must not be sent hunting for a typo
    // that is not there.
    const { resolveModel } = await loadProviders(TEST_KEY)

    await expect(resolveModel(USER_ID, 'anthropic', 'claude-opus-5')).rejects.toMatchObject({
      name: 'UnknownModelError',
      message: 'PromptX has no Anthropic models available yet',
    })
  })
})

describe('resolveModel — the caller’s own key', () => {
  it('uses a stored key and does not touch the shared quota', async () => {
    const { resolveModel } = await loadProviders(TEST_KEY)

    const resolved = await resolveModel(USER_ID, 'openrouter', 'anthropic/claude-opus-5')

    expect(resolved.usedSharedKey).toBe(false)
    expect(resolved.model).toBeDefined()
  })

  it('prefers a personal Google key over the shared one', async () => {
    // The branch order that matters at feature 16: returning here is what keeps
    // a user with their own key from ever being quota-checked.
    const { resolveModel } = await loadProviders(TEST_KEY)

    const resolved = await resolveModel(USER_ID, 'google', OTHER_GOOGLE_MODEL)

    expect(resolved.usedSharedKey).toBe(false)
  })

  it('resolves every model this project actually ships', async () => {
    // Holds the catalog and instantiate() against each other: an entry added
    // under a provider whose factory cannot build it fails here rather than in
    // someone's thread. Note openai and anthropic contribute nothing — their
    // arms of instantiate() stay unreachable while their catalogs are empty.
    const { resolveModel } = await loadProviders(TEST_KEY)

    for (const [provider, models] of Object.entries(MODEL_CATALOG)) {
      for (const model of models) {
        const resolved = await resolveModel(
          USER_ID,
          provider as keyof typeof MODEL_CATALOG,
          model.id,
        )

        expect(resolved.model, `${provider}/${model.id}`).toBeDefined()
      }
    }
  })
})

describe('resolveModel — the shared key as the only fallback', () => {
  it('serves Gemini on the shared key and says so', async () => {
    const { resolveModel } = await loadProviders(null)

    const resolved = await resolveModel(USER_ID, 'google', SHARED_MODEL_ID)

    expect(resolved.usedSharedKey).toBe(true)
    expect(resolved.model).toBeDefined()
  })

  it('refuses a provider the caller has no key for', async () => {
    const { resolveModel, MissingKeyError } = await loadProviders(null)

    await expect(
      resolveModel(USER_ID, 'openrouter', 'anthropic/claude-opus-5'),
    ).rejects.toBeInstanceOf(MissingKeyError)
  })

  it('refuses a catalog Google model that is not the shared one', async () => {
    // The shared key pays for exactly one model. Without this, a keyless user
    // could reach anything Google sells on someone else's bill.
    const { resolveModel, MissingKeyError } = await loadProviders(null)

    await expect(resolveModel(USER_ID, 'google', OTHER_GOOGLE_MODEL)).rejects.toBeInstanceOf(
      MissingKeyError,
    )
  })

  it('names the provider on the error, for the message the user sees', async () => {
    const { resolveModel } = await loadProviders(null)

    await expect(
      resolveModel(USER_ID, 'openrouter', 'anthropic/claude-opus-5'),
    ).rejects.toMatchObject({ provider: 'openrouter', name: 'MissingKeyError' })
  })

  it('claims a slot for the caller it is about to spend one on', async () => {
    const { resolveModel } = await loadProviders(null)

    await resolveModel(USER_ID, 'google', SHARED_MODEL_ID)

    // Persisted by default, which is the half that matters. (F31) The sweep
    // reconciles message_count against `messages`, so a send that claimed an
    // UNpersisted slot would have its claim counted twice — once by the row it
    // wrote and once by compare_count — and the user would be charged double
    // ten minutes later, with nothing on screen to say so.
    expect(reserveSharedSlot).toHaveBeenCalledWith(USER_ID, { persisted: true })
  })

  it('claims an unpersisted slot when told the generation writes no row', async () => {
    // /api/compare's whole quota contract. Without the flag reaching this call
    // the sweep sees a slot with no messages row behind it and refunds it
    // within ten minutes — the daily cap silently stops applying to /compare.
    const { resolveModel } = await loadProviders(null)

    await resolveModel(USER_ID, 'google', SHARED_MODEL_ID, { persisted: false })

    expect(reserveSharedSlot).toHaveBeenCalledWith(USER_ID, { persisted: false })
  })

  it('claims nothing when it refuses', async () => {
    // "A refusal leaves no trace" reaches further than the database writes in
    // the route: a missing key must not cost a slot either, or a user could be
    // charged their daily allowance by asking for a provider they never
    // configured.
    const { resolveModel } = await loadProviders(null)

    await expect(resolveModel(USER_ID, 'openrouter', 'anthropic/claude-opus-5')).rejects.toThrow()
    await expect(resolveModel(USER_ID, 'google', 'gemini-3-ultra')).rejects.toThrow()

    expect(reserveSharedSlot).not.toHaveBeenCalled()
  })
})

describe('resolveModel — who is quota-checked', () => {
  it('never checks the quota for a caller with their own key', async () => {
    // The stated invariant, and the reason the BYOK branch returns EARLY rather
    // than being exempted by a condition further down that somebody has to
    // remember. Their requests must succeed even when the shared allowance —
    // and at feature 17 the global breaker — is spent.
    const { resolveModel } = await loadProviders(TEST_KEY)

    await resolveModel(USER_ID, 'google', SHARED_MODEL_ID)
    await resolveModel(USER_ID, 'openrouter', 'anthropic/claude-opus-5')

    expect(reserveSharedSlot).not.toHaveBeenCalled()
  })

  it('lets a quota refusal out rather than turning it into a model', async () => {
    const quotaSpent = new Error('spent')
    reserveSharedSlot.mockRejectedValue(quotaSpent)

    const { resolveModel } = await loadProviders(null)

    await expect(resolveModel(USER_ID, 'google', SHARED_MODEL_ID)).rejects.toBe(quotaSpent)
  })
})

/**
 * Title generation is system overhead: it runs on the shared key, and it must
 * never spend a user's daily allowance on a title they did not ask for.
 *
 * What enforces that is the signature, which is why it is worth an assertion.
 * `resolveModel` takes a user id because feature 16 will reserve a slot against
 * it; this takes none, so there is no one to charge and no way for the
 * reservation to be added here by accident later.
 */
describe('sharedTitleModel', () => {
  it('serves the shared model without a user to charge', async () => {
    const { sharedTitleModel } = await loadProviders(null)

    expect(sharedTitleModel).toHaveLength(0)
    expect(sharedTitleModel()).toBeDefined()
  })

  it('is a separate entry point from resolveModel', async () => {
    const { resolveModel, sharedTitleModel } = await loadProviders(null)

    const resolved = await resolveModel(USER_ID, 'google', SHARED_MODEL_ID)

    expect(resolved.model).not.toBe(sharedTitleModel())
  })

  it('does not read the caller’s stored key', async () => {
    // It has no caller to read one for. If this ever fails, titling has grown a
    // user context and is one short step from spending that user's allowance.
    const { sharedTitleModel } = await loadProviders(TEST_KEY)

    sharedTitleModel()

    expect(getDecryptedKey).not.toHaveBeenCalled()
  })
})
