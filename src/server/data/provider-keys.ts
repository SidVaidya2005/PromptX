import 'server-only'

import { createServerSupabaseClient } from '@/server/supabase'

import type { Provider, ProviderKeySummary } from '@/types/domain'

/**
 * The `provider_keys` table.
 *
 * This module is the ONLY place that knows the three sealed columns are `bytea`
 * on the wire. Everything above it — `keys.ts`, the route, the vault — speaks
 * Buffers, which is what `src/server/vault.ts` produces and consumes.
 *
 * The reason that translation has to exist at all: `architecture.md` chose
 * `bytea` so there would be "no re-encoding round-trip to get wrong", and over a
 * direct Postgres driver that would hold. But queries here go through PostgREST,
 * which has no binary representation in JSON and renders `bytea` as a
 * hex-escaped string — which is why `src/types/database.ts` types all three as
 * `string`. Handing supabase-js a Buffer does not fail loudly; it serialises to
 * `{"type":"Buffer","data":[…]}` and stores nonsense that only surfaces as a
 * decryption failure much later, against a real user's key. So the round trip is
 * unavoidable, and the response is to put it in exactly one place and prove it
 * with a test that writes and reads back through the real database.
 */

/** The three sealed columns, in the domain's own terms. */
export type SealedColumns = {
  ciphertext: Buffer
  iv: Buffer
  authTag: Buffer
}

/** PostgREST wants `\x`-prefixed hex for a bytea column, not a Buffer. */
function toHex(value: Buffer): string {
  return `\\x${value.toString('hex')}`
}

/** And returns the same shape, which has to be peeled back off. */
function fromHex(value: string): Buffer {
  return Buffer.from(value.startsWith('\\x') ? value.slice(2) : value, 'hex')
}

/**
 * Every stored key for the caller, safe to render.
 *
 * Selects four columns and deliberately not `*`. The omission of `ciphertext`,
 * `iv`, and `auth_tag` is load-bearing: RLS is row-level, so the owner policy
 * would happily return them. Nothing but the application's own restraint keeps
 * sealed key material off this response.
 *
 * No `.eq('user_id', …)`. The owner policy is `(select auth.uid()) = user_id`,
 * so the cookie-bound client can only see the caller's rows — adding a filter
 * would suggest the filter is what isolates them. It is not.
 */
export async function listProviderKeys(): Promise<ProviderKeySummary[]> {
  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase
    .from('provider_keys')
    .select('provider, last_four, label, created_at')
    .order('provider')

  if (error) {
    console.error('[data/provider-keys] listProviderKeys failed', error)
    throw new Error('Failed to load provider keys')
  }

  return data ?? []
}

/**
 * Stores a sealed key, replacing any existing one for the same provider.
 *
 * `unique (user_id, provider)` is what makes this a replace rather than an
 * accumulation — there is no such thing as a second OpenAI key for one user, so
 * "Add" and "Replace" are the same write.
 */
export async function upsertProviderKey(
  userId: string,
  provider: Provider,
  sealed: SealedColumns,
  lastFour: string,
  label: string | null,
): Promise<ProviderKeySummary> {
  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase
    .from('provider_keys')
    .upsert(
      {
        user_id: userId,
        provider,
        ciphertext: toHex(sealed.ciphertext),
        iv: toHex(sealed.iv),
        auth_tag: toHex(sealed.authTag),
        last_four: lastFour,
        label,
      },
      { onConflict: 'user_id,provider' },
    )
    .select('provider, last_four, label, created_at')
    .single()

  if (error) {
    // The row is never logged. It carries the sealed key, and a Supabase error
    // object can echo the payload that caused it.
    console.error('[data/provider-keys] upsertProviderKey failed', {
      provider,
      code: error.code,
    })
    throw new Error('Failed to store provider key')
  }

  return data
}

/**
 * Removes the caller's key for one provider. Returns false when there was none.
 *
 * The boolean comes from `.select()` after the delete, for the reason F10 and
 * F11 both hit: a write that RLS filters out is indistinguishable from a
 * successful no-op, so without a row count the route cannot tell "deleted" from
 * "was never yours" and could not answer 404.
 */
export async function deleteProviderKey(provider: Provider): Promise<boolean> {
  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase
    .from('provider_keys')
    .delete()
    .eq('provider', provider)
    .select('provider')

  if (error) {
    console.error('[data/provider-keys] deleteProviderKey failed', {
      provider,
      code: error.code,
    })
    throw new Error('Failed to remove provider key')
  }

  return (data?.length ?? 0) > 0
}

/**
 * The sealed key for one provider, or null when the caller has none.
 *
 * The only function here that reads the sealed columns, and the only caller
 * permitted is `getDecryptedKey()` in `src/server/keys.ts`. Its return value is
 * ciphertext — useless without `ENCRYPTION_KEY` — but it must still never be
 * handed to anything that shapes a response.
 */
export async function getSealedKey(
  provider: Provider,
): Promise<SealedColumns | null> {
  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase
    .from('provider_keys')
    .select('ciphertext, iv, auth_tag')
    .eq('provider', provider)
    .maybeSingle()

  if (error) {
    console.error('[data/provider-keys] getSealedKey failed', {
      provider,
      code: error.code,
    })
    throw new Error('Failed to load provider key')
  }

  if (!data) return null

  return {
    ciphertext: fromHex(data.ciphertext),
    iv: fromHex(data.iv),
    authTag: fromHex(data.auth_tag),
  }
}
