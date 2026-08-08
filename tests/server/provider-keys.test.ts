import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'

import type { Database } from '@/types/database'

import { requiredEnv } from '../support/env'
import { describeHosted } from '../support/hosted'

/**
 * The bytea round trip, proven against the real database rather than reasoned
 * about.
 *
 * This is the single most likely thing in feature 13 to be subtly wrong. The
 * vault deals in Buffers; the columns are `bytea`; PostgREST has no binary
 * representation in JSON and renders `bytea` as a `\x`-prefixed hex string.
 * Handing supabase-js a Buffer does not throw — it serialises to
 * `{"type":"Buffer","data":[…]}` and stores nonsense, and the damage surfaces
 * much later as a decryption failure against a real user's key.
 *
 * So the assertion that matters is end to end: seal a known string, write it
 * through the real data module, read it back through the real data module,
 * decrypt, and get the original string.
 *
 * `createServerSupabaseClient()` reads cookies through next/headers, which does
 * not exist here — so that one seam is mocked to hand back a genuinely
 * signed-in publishable-key client. Everything below it, including toHex and
 * fromHex, is the real code path running against the real project.
 */

const SUPABASE_URL = requiredEnv('NEXT_PUBLIC_SUPABASE_URL')
const PUBLISHABLE_KEY = requiredEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY')
const SECRET_KEY = requiredEnv('SUPABASE_SECRET_KEY')

/** Deterministic, so the suite does not depend on the developer's own key. */
const TEST_ENCRYPTION_KEY = Buffer.alloc(32, 11).toString('base64')

const admin = createClient<Database>(SUPABASE_URL, SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

let userId: string
let client: SupabaseClient<Database>

type ProviderKeysModule = typeof import('@/server/data/provider-keys')
type VaultModule = typeof import('@/server/vault')

async function load(): Promise<{ data: ProviderKeysModule; vault: VaultModule }> {
  vi.resetModules()
  vi.stubEnv('ENCRYPTION_KEY', TEST_ENCRYPTION_KEY)

  // The only seam mocked. Cookie-bound client construction cannot work outside
  // a request, but everything it would have returned is faithfully replaced by
  // a client carrying a real JWT — so grants, policies and PostgREST are all
  // still in the path.
  vi.doMock('@/server/supabase', () => ({
    createServerSupabaseClient: async () => client,
  }))

  return {
    data: await import('@/server/data/provider-keys'),
    vault: await import('@/server/vault'),
  }
}

beforeAll(async () => {
  const email = `keys-${crypto.randomUUID()}@promptx.test`
  const password = crypto.randomUUID()

  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })

  if (error || !created.user) {
    throw new Error(`could not create the test user: ${error?.message}`)
  }

  userId = created.user.id

  client = createClient<Database>(SUPABASE_URL, PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { error: signInError } = await client.auth.signInWithPassword({
    email,
    password,
  })

  if (signInError) {
    throw new Error(`could not sign in the test user: ${signInError.message}`)
  }
})

afterAll(async () => {
  // The cascade from auth.users clears provider_keys with it.
  if (userId) await admin.auth.admin.deleteUser(userId)
})

describeHosted('provider key storage', () => {
  it('returns the original key after a full write and read through the database', async () => {
    const { data, vault } = await load()
    const plaintext = 'sk-test-round-trip-000000000042'

    const sealed = vault.encrypt(plaintext)

    await data.upsertProviderKey(
      userId,
      'openai',
      sealed,
      vault.lastFour(plaintext),
      null,
    )

    const readBack = await data.getSealedKey('openai')
    expect(readBack).not.toBeNull()

    // The assertion the whole feature rests on.
    expect(vault.decrypt(readBack!)).toBe(plaintext)
  })

  it('stores the sealed columns as bytea, not as a serialised Buffer', async () => {
    const { data, vault } = await load()
    const plaintext = 'sk-test-wire-format-00000000abcd'

    await data.upsertProviderKey(
      userId,
      'anthropic',
      vault.encrypt(plaintext),
      vault.lastFour(plaintext),
      null,
    )

    // Read raw, bypassing the data module, to see what actually landed.
    const { data: raw } = await admin
      .from('provider_keys')
      .select('ciphertext, iv, auth_tag')
      .eq('user_id', userId)
      .eq('provider', 'anthropic')
      .single()

    // The failure this guards against is silent: a Buffer handed to supabase-js
    // becomes {"type":"Buffer","data":[...]} and stores as text that looks fine
    // until something tries to decrypt it.
    expect(raw?.ciphertext).toMatch(/^\\x[0-9a-f]+$/)
    expect(raw?.ciphertext).not.toContain('Buffer')
    // 12 bytes and 16 bytes, hex, plus the two-character \x prefix.
    expect(raw?.iv).toHaveLength(2 + 24)
    expect(raw?.auth_tag).toHaveLength(2 + 32)
  })

  it('replaces rather than accumulates when a key is added twice', async () => {
    const { data, vault } = await load()

    const first = 'sk-test-first-key-0000000000aaaa'
    const second = 'sk-test-second-key-000000000bbbb'

    await data.upsertProviderKey(
      userId,
      'google',
      vault.encrypt(first),
      vault.lastFour(first),
      null,
    )
    await data.upsertProviderKey(
      userId,
      'google',
      vault.encrypt(second),
      vault.lastFour(second),
      'my key',
    )

    const { data: rows } = await admin
      .from('provider_keys')
      .select('last_four')
      .eq('user_id', userId)
      .eq('provider', 'google')

    expect(rows).toHaveLength(1)

    const readBack = await data.getSealedKey('google')
    expect(vault.decrypt(readBack!)).toBe(second)
  })

  it('never selects the sealed columns when listing keys for display', async () => {
    const { data, vault } = await load()
    const plaintext = 'sk-test-listing-00000000000face'

    await data.upsertProviderKey(
      userId,
      'openrouter',
      vault.encrypt(plaintext),
      vault.lastFour(plaintext),
      'router',
    )

    const listed = await data.listProviderKeys()
    const row = listed.find((key) => key.provider === 'openrouter')

    expect(row).toBeDefined()
    expect(Object.keys(row!).sort()).toEqual([
      'created_at',
      'label',
      'last_four',
      'provider',
    ])
    // RLS is row-level, so the owner policy would happily return ciphertext.
    // Nothing but this select keeps it off the wire.
    expect(JSON.stringify(listed)).not.toContain('ciphertext')
  })

  it('reports whether a removal actually removed anything', async () => {
    const { data, vault } = await load()
    const plaintext = 'sk-test-removal-0000000000dead'

    await data.upsertProviderKey(
      userId,
      'openai',
      vault.encrypt(plaintext),
      vault.lastFour(plaintext),
      null,
    )

    // A write RLS filters out is indistinguishable from a successful no-op, so
    // the route needs the row count to answer 404 rather than a false 204.
    expect(await data.deleteProviderKey('openai')).toBe(true)
    expect(await data.deleteProviderKey('openai')).toBe(false)
    expect(await data.getSealedKey('openai')).toBeNull()
  })

  it('returns null for a provider the caller has no key for', async () => {
    const { data } = await load()

    // 'openai' was removed by the previous case; this asserts absence reads as
    // null rather than throwing.
    expect(await data.getSealedKey('openai')).toBeNull()
  })
})
