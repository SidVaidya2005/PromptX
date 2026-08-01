import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The invariant this whole feature exists to hold: no decrypted provider key
 * ever leaves the server.
 *
 * Two halves, because neither is sufficient alone. The behavioural test pins
 * what POST /api/keys returns today. The static scan is what stays true as the
 * application grows — it fails when someone *adds* a route that reaches for a
 * plaintext key, which is the mistake worth catching, and which no test of
 * today's routes can see coming.
 */

const SRC = fileURLToPath(new URL('../../src', import.meta.url))

function filesUnder(dir: string): string[] {
  const entries = readdirSync(dir)
  const files: string[] = []

  for (const entry of entries) {
    const full = path.join(dir, entry)

    if (statSync(full).isDirectory()) {
      files.push(...filesUnder(full))
      continue
    }

    if (/\.tsx?$/.test(entry)) files.push(full)
  }

  return files
}

function read(file: string): string {
  return readFileSync(file, 'utf8')
}

/** Reported relative to src/, so a failure names something recognisable. */
function relative(file: string): string {
  return path.relative(SRC, file)
}

describe('no decrypted key can reach a response', () => {
  it('no route or page imports the vault decrypt function', () => {
    const offenders = filesUnder(path.join(SRC, 'app'))
      .filter((file) => {
        const source = read(file)
        return (
          /from\s+'@\/server\/vault'/.test(source) &&
          /\bdecrypt\b/.test(source)
        )
      })
      .map(relative)

    // resolveModel() in src/server/providers.ts is the only sanctioned caller,
    // and it is not under src/app/.
    expect(offenders).toEqual([])
  })

  it('no route or page imports getDecryptedKey', () => {
    const offenders = filesUnder(path.join(SRC, 'app'))
      .filter((file) => /\bgetDecryptedKey\b/.test(read(file)))
      .map(relative)

    expect(offenders).toEqual([])
  })

  it('nothing rendered or routed mentions the sealed columns', () => {
    const offenders = [
      ...filesUnder(path.join(SRC, 'app')),
      ...filesUnder(path.join(SRC, 'components')),
    ]
      .filter((file) => /\b(ciphertext|auth_tag|authTag)\b/.test(read(file)))
      .map(relative)

    expect(offenders).toEqual([])
  })

  it('no client component imports from the server tree', () => {
    const offenders = filesUnder(path.join(SRC, 'components'))
      .filter((file) => /from\s+'@\/server\//.test(read(file)))
      .map(relative)

    // Also an ESLint rule (import/no-restricted-paths). Asserted here too
    // because lint is a separate step that a commit can skip and this cannot.
    expect(offenders).toEqual([])
  })
})

describe('POST /api/keys', () => {
  const VALID_ENV = {
    SUPABASE_SECRET_KEY: 'sb_secret_test_value',
    ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    SHARED_GEMINI_API_KEY: 'test-gemini-key',
    NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
    NEXT_PUBLIC_SITE_URL: 'https://test.promptx.local',
  }

  beforeEach(() => {
    vi.resetModules()
    for (const [key, value] of Object.entries(VALID_ENV)) {
      vi.stubEnv(key, value)
    }
  })

  it('returns exactly provider, lastFour, label and createdAt', async () => {
    const secret = 'sk-test-0000000000000000abcd'

    vi.doMock('@/server/auth', () => ({
      getUser: async () => ({ id: 'user-1' }),
    }))

    vi.doMock('@/server/keys', () => ({
      storeProviderKey: async () => ({
        provider: 'openai',
        last_four: 'abcd',
        label: null,
        created_at: '2026-08-01T00:00:00.000Z',
      }),
      InvalidKeyError: class InvalidKeyError extends Error {},
      ProbeUnavailableError: class ProbeUnavailableError extends Error {},
    }))

    vi.doMock('@/server/data/provider-keys', () => ({
      deleteProviderKey: vi.fn(),
    }))

    const { POST } = await import('@/app/api/keys/route')

    const response = await POST(
      new Request('http://localhost/api/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'openai', apiKey: secret }),
      }),
    )

    expect(response.status).toBe(201)

    const body = (await response.json()) as Record<string, unknown>

    // An exact match, not a subset. A widened select() below this route would
    // add columns here, and asserting "contains lastFour" would not notice.
    expect(Object.keys(body).sort()).toEqual([
      'createdAt',
      'label',
      'lastFour',
      'provider',
    ])

    // And the submitted key appears nowhere in the response at all.
    expect(JSON.stringify(body)).not.toContain(secret)
  })

  it('does not echo the submitted key when the body fails validation', async () => {
    // A zod error detail would reflect the offending value straight back. On
    // this route that value is an API key.
    const secret = 'sk-test-0000000000000000abcd'

    vi.doMock('@/server/auth', () => ({
      getUser: async () => ({ id: 'user-1' }),
    }))
    vi.doMock('@/server/keys', () => ({
      storeProviderKey: vi.fn(),
      InvalidKeyError: class InvalidKeyError extends Error {},
      ProbeUnavailableError: class ProbeUnavailableError extends Error {},
    }))
    vi.doMock('@/server/data/provider-keys', () => ({
      deleteProviderKey: vi.fn(),
    }))

    const { POST } = await import('@/app/api/keys/route')

    const response = await POST(
      new Request('http://localhost/api/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Invalid: `provider` is not in the enum. The apiKey is well-formed and
        // present, so anything echoing the parsed input would leak it.
        body: JSON.stringify({ provider: 'not-a-provider', apiKey: secret }),
      }),
    )

    expect(response.status).toBe(400)
    expect(await response.text()).not.toContain(secret)
  })
})
