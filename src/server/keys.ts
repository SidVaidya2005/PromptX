import 'server-only'

import { KEY_PROBE_TIMEOUT_MS, PROVIDER_LABELS } from '@/lib/constants'

import {
  getSealedKey,
  upsertProviderKey,
} from '@/server/data/provider-keys'
import { decrypt, encrypt, lastFour } from '@/server/vault'

import type { Provider, ProviderKeySummary } from '@/types/domain'

/**
 * Storing, probing, and opening a user's provider keys.
 *
 * The one rule that governs this file: a plaintext key exists only as a local
 * variable inside a single call. It is never returned to a caller that shapes a
 * response, never assigned to module scope, never cached, and never logged.
 * Every failure here logs the provider and — where it has one — the user id, and
 * nothing else.
 */

/**
 * How each provider's key is checked before it is stored.
 *
 * A models-list request rather than a generation: it costs no tokens, needs no
 * model id (the catalog does not exist until feature 14), and answers the only
 * question being asked, which is whether this key is real and live right now.
 *
 * What it does not prove is that inference is enabled on the key — a models
 * endpoint can answer for a key that cannot generate. That is the accepted gap,
 * and it is still open: this comment used to say feature 14 was where a real
 * generation path would catch it, which was wrong. F14 gave the key a place to
 * be USED, not a second place to be checked, and moving the probe to a
 * generation would spend a user's money to validate a paste. The gap now
 * surfaces where it always would have — as a failed first message, carrying the
 * provider's own reason. Measured at F14: an OpenRouter key with too small a
 * balance probes clean and then answers 402. (F14)
 */
type ProbeSpec = {
  url: (apiKey: string) => string
  headers: (apiKey: string) => Record<string, string>
}

const PROBES: Record<Provider, ProbeSpec> = {
  openai: {
    url: () => 'https://api.openai.com/v1/models',
    headers: (apiKey) => ({ Authorization: `Bearer ${apiKey}` }),
  },
  anthropic: {
    url: () => 'https://api.anthropic.com/v1/models',
    headers: (apiKey) => ({
      'x-api-key': apiKey,
      // Required on every Anthropic request; omitting it is a 400, which would
      // read as "unverifiable" rather than the successful probe it should be.
      'anthropic-version': '2023-06-01',
    }),
  },
  google: {
    // Google takes the key as a query parameter rather than a header. It
    // therefore lands in the URL — which is exactly why nothing in this module
    // logs a URL.
    url: (apiKey) =>
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
    headers: () => ({}),
  },
  openrouter: {
    // The key-info endpoint rather than the models list: it is scoped to the
    // presented key, so it cannot answer 200 for an unauthenticated request the
    // way a public catalog might.
    url: () => 'https://openrouter.ai/api/v1/key',
    headers: (apiKey) => ({ Authorization: `Bearer ${apiKey}` }),
  },
}

/**
 * Checks a key against its provider before anything is written.
 *
 * Two failures, kept apart on purpose. A 401 or 403 is the provider saying the
 * key is wrong, and the user needs to hear that. Anything else — a timeout, a
 * 5xx, a DNS failure — means we could not find out, and telling someone their
 * correct key is invalid because a provider had a bad minute sends them off to
 * regenerate a key that was fine.
 *
 * Both paths refuse. Nothing unverified is ever stored.
 *
 * @throws InvalidKeyError when the provider rejects the key outright.
 * @throws ProbeUnavailableError when the check could not be completed.
 */
export async function probeKey(provider: Provider, apiKey: string): Promise<void> {
  const spec = PROBES[provider]

  let response: Response

  try {
    response = await fetch(spec.url(apiKey), {
      method: 'GET',
      headers: spec.headers(apiKey),
      // Nothing in the platform will cut this off. Render allows a 100-minute
      // request, and a person is waiting on this one.
      signal: AbortSignal.timeout(KEY_PROBE_TIMEOUT_MS),
    })
  } catch (error) {
    // A timeout, a refused connection, a DNS failure. The error is logged
    // WITHOUT the URL, because Google's carries the key in its query string.
    console.error('[server/keys] probe could not reach provider', {
      provider,
      reason: error instanceof Error ? error.name : 'unknown',
    })
    throw new ProbeUnavailableError(provider)
  }

  if (response.ok) return

  if (response.status === 401 || response.status === 403) {
    throw new InvalidKeyError(provider)
  }

  // A 429 or a 5xx says nothing about the key. Neither does a 400, which more
  // often means this probe is shaped wrong than that the key is.
  console.error('[server/keys] probe returned an inconclusive status', {
    provider,
    status: response.status,
  })
  throw new ProbeUnavailableError(provider)
}

/**
 * Probes, seals, and stores a key, returning only what may be displayed.
 *
 * The order is the feature: nothing is written until the provider has confirmed
 * the key, so a rejected key leaves no row behind and no half-configured
 * provider in the list.
 *
 * @throws InvalidKeyError | ProbeUnavailableError before anything is persisted.
 */
export async function storeProviderKey(
  userId: string,
  provider: Provider,
  apiKey: string,
  label: string | null,
): Promise<ProviderKeySummary> {
  await probeKey(provider, apiKey)

  const sealed = encrypt(apiKey)

  return upsertProviderKey(userId, provider, sealed, lastFour(apiKey), label)
}

/**
 * The caller's decrypted key for one provider, or null when they have none.
 *
 * Returns PLAINTEXT. The only sanctioned caller is `resolveModel()` in
 * `src/server/providers.ts`, which uses it to instantiate a provider client and
 * lets it fall out of scope. It has no caller until feature 14. It must never be
 * reached from a route handler, a Server Component, or anything that shapes a
 * response — a static test in `tests/security/key-exposure.test.ts` enforces
 * that, because a comment cannot.
 */
export async function getDecryptedKey(provider: Provider): Promise<string | null> {
  const sealed = await getSealedKey(provider)

  if (!sealed) return null

  return decrypt(sealed)
}

/** The provider rejected the key. Maps to 400 `invalid_key`. */
export class InvalidKeyError extends Error {
  constructor(readonly provider: Provider) {
    super(`${PROVIDER_LABELS[provider]} rejected that key`)
    this.name = 'InvalidKeyError'
  }
}

/** The key could not be checked. Maps to 503 `probe_unavailable`. */
export class ProbeUnavailableError extends Error {
  constructor(readonly provider: Provider) {
    super(`Could not reach ${PROVIDER_LABELS[provider]} to verify that key`)
    this.name = 'ProbeUnavailableError'
  }
}
