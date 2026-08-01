import 'server-only'

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

import { serverEnv } from '@/server/env'

/**
 * AES-256-GCM seal and open for provider API keys.
 *
 * This is the most security-sensitive module in the codebase: it is the only
 * thing standing between a database read and every user's OpenAI, Anthropic,
 * Google, and OpenRouter keys. Three rules hold it up, and none is optional.
 *
 *   1. GCM, never CBC or ECB. CBC has no integrity — a tampered ciphertext
 *      decrypts to garbage that the caller cannot distinguish from a real key.
 *   2. A fresh random IV per encryption. Reusing an IV under GCM leaks the key
 *      stream and is a catastrophic, unrecoverable failure. It is therefore
 *      never derived from the user id, the provider, or a counter.
 *   3. The auth tag is always stored and always verified. Decrypting without
 *      setAuthTag silently accepts forged ciphertext.
 *
 * THIS MODULE DOES NOT LOG. Not an error, not a provider name, not a length,
 * not temporarily while debugging. Everything it touches is either the master
 * key or a plaintext provider key, and a log line is a response body that
 * happens to be written to disk. Callers log — they have the user id and the
 * provider, which is what is actually useful, and neither is secret.
 */

const ALGORITHM = 'aes-256-gcm'

/** 96 bits — the size GCM is specified for, and the only one to use. */
const IV_BYTES = 12

/**
 * The master key, decoded from the validated environment.
 *
 * Read through `serverEnv` rather than `process.env` deliberately: env.ts is
 * the one module that reads a secret, and its zod schema already proves this
 * value decodes to exactly 32 bytes before the process finishes booting.
 * Re-validating the length here would put the same rule in two places, free to
 * drift apart — so there is no length check below, and that absence is the
 * point rather than an oversight.
 *
 * Decoded per call instead of cached. It is a 32-byte base64 decode, and
 * `serverEnv` already holds the string for the life of the process, so a
 * module-level Buffer would buy nothing.
 */
function masterKey(): Buffer {
  return Buffer.from(serverEnv.ENCRYPTION_KEY, 'base64')
}

/**
 * A sealed secret, in the three parts the `provider_keys` columns expect.
 *
 * Buffers rather than base64 text, matching the `bytea` columns exactly — there
 * is no re-encoding round trip to get wrong on the way in or out.
 */
export type SealedSecret = {
  ciphertext: Buffer
  iv: Buffer
  authTag: Buffer
}

/** Seals a provider key. Every call generates a fresh IV; none is ever reused. */
export function encrypt(plaintext: string): SealedSecret {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, masterKey(), iv)

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ])

  // Must be read AFTER final() — before it, the tag is not yet computed.
  return { ciphertext, iv, authTag: cipher.getAuthTag() }
}

/**
 * Opens a sealed secret.
 *
 * Throws {@link DecryptionError} if the ciphertext, IV, or auth tag has been
 * modified, or if the master key has been rotated since the row was written.
 * Those two cases are indistinguishable from here, which is why the error says
 * neither.
 */
export function decrypt({ ciphertext, iv, authTag }: SealedSecret): string {
  try {
    const decipher = createDecipheriv(ALGORITHM, masterKey(), iv)

    // The integrity check itself. Without this line final() accepts anything,
    // and every guarantee in this file evaporates silently.
    decipher.setAuthTag(authTag)

    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8')
  } catch {
    // The original error is discarded rather than chained. node's message
    // carries no key material today, but `cause` is the kind of field that
    // ends up in a log line or a response body by accident, and this module's
    // whole job is that nothing here ever does.
    throw new DecryptionError()
  }
}

/**
 * The only representation of a provider key permitted to leave the server.
 *
 * Not cryptographic, and here anyway: it belongs beside the thing it is safe
 * instead of. Every response shape that wants to show a key shows this.
 */
export function lastFour(apiKey: string): string {
  return apiKey.slice(-4)
}

/**
 * Thrown when a stored key cannot be opened.
 *
 * Carries no ciphertext, no plaintext, no key material, and no `cause`, so it
 * is safe to let it reach a caller that logs. It means the row is unusable and
 * the user must add their key again — it never means "try harder".
 */
export class DecryptionError extends Error {
  constructor() {
    super('Could not decrypt the stored key')
    this.name = 'DecryptionError'
  }
}
