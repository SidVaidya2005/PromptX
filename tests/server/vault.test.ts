import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The vault reads its master key through src/server/env.ts, which parses the
 * secret environment ONCE at module load. vi.stubEnv alone therefore cannot
 * reach it — by the time a test runs, serverEnv is already frozen at whatever
 * the environment held on first import.
 *
 * So every case resets the module registry and imports the vault fresh, which
 * is the same pattern tests/server/env.test.ts uses for the same reason.
 *
 * One consequence worth knowing: each import produces a NEW DecryptionError
 * class. An `instanceof` assertion only holds against the class from the same
 * loadVault() call, which is why the helper returns the whole module rather
 * than letting tests import the error separately.
 */

const KEY_32 = Buffer.alloc(32, 7).toString('base64')

/**
 * env.ts validates the whole secret environment, not just the one variable
 * under test, so all three are stubbed. Deliberately not read from .env.local
 * (which vitest.config.ts does load) — the suite must give the same result on
 * a machine that has never held a real key.
 */
const VALID_ENV = {
  SUPABASE_SECRET_KEY: 'sb_secret_test_value',
  ENCRYPTION_KEY: KEY_32,
  SHARED_GEMINI_API_KEY: 'test-gemini-key',
}

type Vault = typeof import('@/server/vault')

/**
 * Corrupts one byte in place.
 *
 * Via the Buffer API rather than `buffer[0] ^= 0xff`, because
 * noUncheckedIndexedAccess types an index read as `number | undefined` and the
 * compound assignment does not narrow it.
 */
function flipFirstByte(buffer: Buffer): void {
  buffer.writeUInt8(buffer.readUInt8(0) ^ 0xff, 0)
}

function loadVault(overrides: Partial<typeof VALID_ENV> = {}): Promise<Vault> {
  for (const [key, value] of Object.entries({ ...VALID_ENV, ...overrides })) {
    vi.stubEnv(key, value)
  }

  return import('@/server/vault')
}

describe('vault', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('returns the original key after a round trip', async () => {
    const { encrypt, decrypt } = await loadVault()

    expect(decrypt(encrypt('sk-test-abcdef1234'))).toBe('sk-test-abcdef1234')
  })

  it('round trips a long key containing multi-byte characters', async () => {
    const { encrypt, decrypt } = await loadVault()
    // Provider keys are ASCII, but a utf8 bug that only shows on multi-byte
    // input is exactly the kind that survives to production.
    const plaintext = `sk-${'é'.repeat(400)}—🔑`

    expect(decrypt(encrypt(plaintext))).toBe(plaintext)
  })

  it('produces a 12-byte IV and a 16-byte auth tag', async () => {
    const { encrypt } = await loadVault()

    const sealed = encrypt('sk-test-abcdef1234')

    expect(sealed.iv).toHaveLength(12)
    expect(sealed.authTag).toHaveLength(16)
  })

  it('never reuses an IV across a thousand encryptions', async () => {
    const { encrypt } = await loadVault()

    const sealed = Array.from({ length: 1000 }, () => encrypt('sk-identical'))

    const ivs = new Set(sealed.map((s) => s.iv.toString('hex')))
    expect(ivs.size).toBe(1000)

    // The same plaintext sealed a thousand times must also produce a thousand
    // distinct ciphertexts. If it did not, the IV is not actually reaching the
    // cipher, and a set of unique IVs would be proving nothing.
    const ciphertexts = new Set(sealed.map((s) => s.ciphertext.toString('hex')))
    expect(ciphertexts.size).toBe(1000)
  })

  /**
   * All three fields are corrupted independently, so no one of them can be the
   * only thing verified.
   *
   * What these three do NOT catch, measured rather than assumed: deleting
   * `setAuthTag` entirely leaves all three green. Node refuses `final()` on a
   * GCM decipher that was never given a tag, so they still throw — for a
   * completely different reason. The round-trip tests above are what actually
   * fail on that mutation. Neither half of the suite is redundant.
   */
  it('refuses ciphertext that has been modified', async () => {
    const { encrypt, decrypt, DecryptionError } = await loadVault()

    const sealed = encrypt('sk-test-abcdef1234')
    flipFirstByte(sealed.ciphertext)

    expect(() => decrypt(sealed)).toThrow(DecryptionError)
  })

  it('refuses an auth tag that has been modified', async () => {
    const { encrypt, decrypt, DecryptionError } = await loadVault()

    const sealed = encrypt('sk-test-abcdef1234')
    flipFirstByte(sealed.authTag)

    expect(() => decrypt(sealed)).toThrow(DecryptionError)
  })

  it('refuses an IV that has been modified', async () => {
    const { encrypt, decrypt, DecryptionError } = await loadVault()

    const sealed = encrypt('sk-test-abcdef1234')
    flipFirstByte(sealed.iv)

    expect(() => decrypt(sealed)).toThrow(DecryptionError)
  })

  it('reveals nothing about the key material when decryption fails', async () => {
    const { encrypt, decrypt, DecryptionError } = await loadVault()

    const plaintext = 'sk-test-abcdef1234'
    const sealed = encrypt(plaintext)
    flipFirstByte(sealed.ciphertext)

    // Captured rather than asserted inside a catch block. An expect() that
    // throws from inside its own try is caught by that same catch and then
    // cheerfully asserted against — which is exactly how an earlier draft of
    // this test passed against a decrypt() that never threw at all.
    let caught: unknown
    try {
      decrypt(sealed)
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(DecryptionError)

    const serialised = JSON.stringify({
      message: (caught as Error).message,
      // A `cause` chain is the likeliest way payload leaks back out.
      cause: (caught as Error).cause ?? null,
      stack: (caught as Error).stack ?? '',
    })

    expect(serialised).not.toContain(plaintext)
    expect(serialised).not.toContain(KEY_32)
    expect((caught as Error).cause).toBeUndefined()
  })

  it('cannot be loaded when the master key is not 32 bytes', async () => {
    // The length rule lives in env.ts and is enforced at boot. This asserts the
    // vault inherits it — that there is no path to a cipher built from a
    // malformed key, not that the vault checks the length itself.
    await expect(
      loadVault({ ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') }),
    ).rejects.toThrow(/32 bytes/)
  })

  it('exposes only the last four characters of a key', async () => {
    const { lastFour } = await loadVault()

    expect(lastFour('sk-proj-abcdefghijkl4f2a')).toBe('4f2a')
  })
})
