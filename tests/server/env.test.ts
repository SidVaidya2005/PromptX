import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * src/server/env.ts validates at MODULE LOAD, which is what makes a missing
 * secret a boot failure rather than a failure at the first request that needs
 * it. Testing that means re-importing the module per case with a different
 * environment stubbed, hence vi.resetModules() rather than a plain import.
 */
const VALID_ENV = {
  SUPABASE_SECRET_KEY: 'sb_secret_test_value',
  ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  SHARED_GEMINI_API_KEY: 'test-gemini-key',
}

function stubEnv(overrides: Partial<typeof VALID_ENV> = {}) {
  for (const [key, value] of Object.entries({ ...VALID_ENV, ...overrides })) {
    vi.stubEnv(key, value)
  }
}

describe('server environment', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('accepts a complete, well-formed secret environment', async () => {
    stubEnv()

    const { serverEnv } = await import('@/server/env')

    expect(serverEnv.SUPABASE_SECRET_KEY).toBe('sb_secret_test_value')
    expect(serverEnv.SHARED_GEMINI_API_KEY).toBe('test-gemini-key')
  })

  it('refuses to boot when ENCRYPTION_KEY does not decode to 32 bytes', async () => {
    stubEnv({ ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') })

    await expect(import('@/server/env')).rejects.toThrow(/32 bytes/)
  })

  it('refuses to boot when a secret is missing entirely', async () => {
    stubEnv()
    vi.stubEnv('SHARED_GEMINI_API_KEY', '')

    await expect(import('@/server/env')).rejects.toThrow()
  })
})
