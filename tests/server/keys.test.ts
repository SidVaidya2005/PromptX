import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Provider } from '@/types/domain'

/**
 * The probe decides whether a key is ever stored, so what it does with each
 * kind of failure is the security-relevant behaviour here — not whether it can
 * talk to OpenAI.
 *
 * `fetch` is stubbed for every case. No test in this file may reach a real
 * provider: `code-standards.md` forbids it, and a suite that depends on four
 * third-party APIs being up is a suite that goes red for reasons that have
 * nothing to do with the code.
 *
 * The whole secret environment is stubbed and the module imported fresh,
 * because importing keys.ts pulls in the vault and the Supabase client, both of
 * which validate their configuration at load. Same reason as
 * tests/server/vault.test.ts, and it keeps this suite runnable on a machine
 * that has never held a real key.
 */

const VALID_ENV = {
  SUPABASE_SECRET_KEY: 'sb_secret_test_value',
  ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  SHARED_GEMINI_API_KEY: 'test-gemini-key',
  NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
  NEXT_PUBLIC_SITE_URL: 'https://test.promptx.local',
}

/** Long enough to clear the schema's floor, and obviously not a real key. */
const TEST_KEY = 'sk-test-0000000000000000abcd'

type Keys = typeof import('@/server/keys')

function loadKeys(): Promise<Keys> {
  for (const [key, value] of Object.entries(VALID_ENV)) {
    vi.stubEnv(key, value)
  }

  return import('@/server/keys')
}

/** A minimal Response stand-in — probeKey reads `ok` and `status`, nothing else. */
function respondWith(status: number) {
  return vi.fn(async () => new Response(null, { status }))
}

const PROVIDERS: Provider[] = ['openai', 'anthropic', 'google', 'openrouter']

describe('probeKey', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    // vitest.config sets restoreMocks and unstubEnvs, but not unstubGlobals, so
    // a stubbed fetch would otherwise leak into the next test.
    vi.unstubAllGlobals()
  })

  describe('accepts a key the provider recognises', () => {
    for (const provider of PROVIDERS) {
      it(`accepts a ${provider} key on 200`, async () => {
        vi.stubGlobal('fetch', respondWith(200))
        const { probeKey } = await loadKeys()

        await expect(probeKey(provider, TEST_KEY)).resolves.toBeUndefined()
      })
    }
  })

  describe('tells "your key is wrong" apart from "we could not find out"', () => {
    for (const status of [401, 403]) {
      it(`treats ${status} as an invalid key`, async () => {
        vi.stubGlobal('fetch', respondWith(status))
        const { probeKey, InvalidKeyError } = await loadKeys()

        await expect(probeKey('openai', TEST_KEY)).rejects.toBeInstanceOf(
          InvalidKeyError,
        )
      })
    }

    // A 429 or a 5xx says nothing about the key, and a 400 more often means the
    // probe is shaped wrong than that the key is. Reporting any of these as
    // "invalid" sends someone off to regenerate a key that was fine.
    for (const status of [400, 429, 500, 502, 503]) {
      it(`treats ${status} as unverifiable rather than invalid`, async () => {
        vi.stubGlobal('fetch', respondWith(status))
        const { probeKey, ProbeUnavailableError } = await loadKeys()

        await expect(probeKey('openai', TEST_KEY)).rejects.toBeInstanceOf(
          ProbeUnavailableError,
        )
      })
    }

    it('treats a network failure as unverifiable', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          throw new TypeError('fetch failed')
        }),
      )
      const { probeKey, ProbeUnavailableError } = await loadKeys()

      await expect(probeKey('openai', TEST_KEY)).rejects.toBeInstanceOf(
        ProbeUnavailableError,
      )
    })

    it('treats a timeout as unverifiable', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          const error = new Error('The operation was aborted')
          error.name = 'TimeoutError'
          throw error
        }),
      )
      const { probeKey, ProbeUnavailableError } = await loadKeys()

      await expect(probeKey('openai', TEST_KEY)).rejects.toBeInstanceOf(
        ProbeUnavailableError,
      )
    })
  })

  describe('presents the key the way each provider expects', () => {
    it('sends an OpenAI key as a bearer token', async () => {
      const fetchMock = respondWith(200)
      vi.stubGlobal('fetch', fetchMock)
      const { probeKey } = await loadKeys()

      await probeKey('openai', TEST_KEY)

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.openai.com/v1/models',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Bearer ${TEST_KEY}`,
          }),
        }),
      )
    })

    it('sends the anthropic-version header, without which the probe would 400', async () => {
      const fetchMock = respondWith(200)
      vi.stubGlobal('fetch', fetchMock)
      const { probeKey } = await loadKeys()

      await probeKey('anthropic', TEST_KEY)

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.anthropic.com/v1/models',
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-api-key': TEST_KEY,
            'anthropic-version': expect.any(String),
          }),
        }),
      )
    })

    it('puts a Google key in the query string, url-encoded', async () => {
      const fetchMock = respondWith(200)
      vi.stubGlobal('fetch', fetchMock)
      const { probeKey } = await loadKeys()

      await probeKey('google', 'AIza-test-0000000000000/+key')

      // The raw '/' and '+' must not survive into the query unescaped — '+'
      // decodes as a space server-side, which would silently probe a different
      // key than the one submitted.
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('key=AIza-test-0000000000000%2F%2Bkey'),
        expect.anything(),
      )
    })

    it('bounds every probe with an abort signal', async () => {
      const fetchMock = respondWith(200)
      vi.stubGlobal('fetch', fetchMock)
      const { probeKey } = await loadKeys()

      await probeKey('openrouter', TEST_KEY)

      // Nothing in the platform will cut a hung request off — Render allows 100
      // minutes, and someone is waiting on this one.
      expect(fetchMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      )
    })
  })

  it('never puts the key into the error it throws', async () => {
    vi.stubGlobal('fetch', respondWith(401))
    const { probeKey } = await loadKeys()

    const error = await probeKey('openai', TEST_KEY).catch((e: unknown) => e)

    const serialised = JSON.stringify({
      message: (error as Error).message,
      stack: (error as Error).stack ?? '',
    })
    expect(serialised).not.toContain(TEST_KEY)
  })
})

describe('storeProviderKey', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /**
   * The ordering invariant: nothing is written until the provider has confirmed
   * the key. A rejected key that still left a row behind would show the user a
   * configured provider that cannot answer anything.
   */
  it('writes nothing when the provider rejects the key', async () => {
    const upsert = vi.fn()
    vi.doMock('@/server/data/provider-keys', () => ({
      upsertProviderKey: upsert,
      getSealedKey: vi.fn(),
    }))

    vi.stubGlobal('fetch', respondWith(401))
    const { storeProviderKey, InvalidKeyError } = await loadKeys()

    await expect(
      storeProviderKey('user-1', 'openai', TEST_KEY, null),
    ).rejects.toBeInstanceOf(InvalidKeyError)

    expect(upsert).not.toHaveBeenCalled()
  })

  it('writes nothing when the provider cannot be reached', async () => {
    const upsert = vi.fn()
    vi.doMock('@/server/data/provider-keys', () => ({
      upsertProviderKey: upsert,
      getSealedKey: vi.fn(),
    }))

    vi.stubGlobal('fetch', respondWith(500))
    const { storeProviderKey, ProbeUnavailableError } = await loadKeys()

    await expect(
      storeProviderKey('user-1', 'openai', TEST_KEY, null),
    ).rejects.toBeInstanceOf(ProbeUnavailableError)

    expect(upsert).not.toHaveBeenCalled()
  })

  it('stores only the last four characters alongside the sealed key', async () => {
    type Sealed = { ciphertext: Buffer; iv: Buffer; authTag: Buffer }

    // Captured through the implementation rather than read off mock.calls,
    // which noUncheckedIndexedAccess types as possibly undefined.
    let sealedSeen: Sealed | null = null

    const upsert = vi.fn(
      // Declares only as far as the argument it captures; the two after it are
      // still verified, by toHaveBeenCalledWith below.
      async (_userId: string, _provider: Provider, sealed: Sealed) => {
        sealedSeen = sealed
        return {
          provider: 'openai' as Provider,
          last_four: 'abcd',
          label: null,
          created_at: '2026-08-01T00:00:00Z',
        }
      },
    )

    vi.doMock('@/server/data/provider-keys', () => ({
      upsertProviderKey: upsert,
      getSealedKey: vi.fn(),
    }))

    vi.stubGlobal('fetch', respondWith(200))
    const { storeProviderKey } = await loadKeys()

    await storeProviderKey('user-1', 'openai', TEST_KEY, null)

    // Only the final four characters are stored in the clear.
    expect(upsert).toHaveBeenCalledWith(
      'user-1',
      'openai',
      expect.anything(),
      'abcd',
      null,
    )

    const sealed = sealedSeen as Sealed | null
    expect(sealed).not.toBeNull()
    // The plaintext must not be among the columns being written.
    expect(sealed?.ciphertext.toString('utf8')).not.toContain(TEST_KEY)
    expect(sealed?.iv).toHaveLength(12)
    expect(sealed?.authTag).toHaveLength(16)
  })
})
