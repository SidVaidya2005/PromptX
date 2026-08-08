import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'

import { DEFAULT_CONVERSATION_TITLE, SHARE_SLUG_LENGTH } from '@/lib/constants'

import {
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  shareConversation,
  touchConversation,
  unshareConversation,
  updateConversationModel,
} from '@/server/data/conversations'

import type { Database } from '@/types/database'

import { requiredEnv } from '../support/env'
import { describeHosted } from '../support/hosted'

/**
 * The half of `data/conversations.ts` no suite had reached: creation, the
 * sidebar read, the activity touch, sharing, revoking and deletion.
 *
 * Rename, pin, archive and system prompt already have their own files. Those
 * reimplement the statement each function issues; this one imports the functions
 * and swaps only the cookie-bound client, so the module itself is what runs.
 *
 * Three things here are load-bearing beyond the obvious:
 *
 * - **`touchConversation` is not bookkeeping.** There is no trigger on
 *   `updated_at` and the sidebar orders on it, so skipping it makes the list
 *   silently stop reflecting activity with nothing to indicate why.
 * - **sharing twice returns the SAME slug.** A second click must not break a
 *   link somebody has already pasted somewhere; only revoke-then-share mints a
 *   new one, and then the old URL is dead for good.
 * - **the sidebar read selects columns by name.** `system_prompt` can be ten
 *   thousand characters the sidebar has no use for, and there is no CDN in front
 *   of the origin.
 */

const SUPABASE_URL = requiredEnv('NEXT_PUBLIC_SUPABASE_URL')
const PUBLISHABLE_KEY = requiredEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY')
const SECRET_KEY = requiredEnv('SUPABASE_SECRET_KEY')

const admin = createClient<Database>(SUPABASE_URL, SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

type Actor = { id: string; client: SupabaseClient<Database> }

let owner: Actor
let stranger: Actor
let sessionClient: SupabaseClient<Database>

vi.mock('@/server/supabase', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/supabase')>()),
  createServerSupabaseClient: async () => sessionClient,
}))

async function createActor(label: string): Promise<Actor> {
  const email = `conv-life-${label}-${crypto.randomUUID()}@promptx.test`
  const password = crypto.randomUUID()

  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })

  if (error || !created.user) {
    throw new Error(`could not create ${label}: ${error?.message}`)
  }

  const client = createClient<Database>(SUPABASE_URL, PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { error: signInError } = await client.auth.signInWithPassword({ email, password })
  if (signInError) throw new Error(`could not sign in ${label}: ${signInError.message}`)

  return { id: created.user.id, client }
}

async function seedConversation(
  userId: string,
  overrides: Partial<Database['public']['Tables']['conversations']['Insert']> = {},
): Promise<string> {
  const { data, error } = await admin
    .from('conversations')
    .insert({
      user_id: userId,
      title: 'Seeded',
      provider: 'google',
      model_id: 'gemini-3.6-flash',
      ...overrides,
    })
    .select('id')
    .single()

  if (error) throw error
  return data.id
}

async function readRow(id: string) {
  const { data, error } = await admin
    .from('conversations')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) throw error
  return data
}

async function clearConversations(userId: string) {
  const { error } = await admin.from('conversations').delete().eq('user_id', userId)
  if (error) throw error
}

beforeAll(async () => {
  ;[owner, stranger] = await Promise.all([createActor('owner'), createActor('stranger')])
}, 30_000)

beforeEach(async () => {
  sessionClient = owner.client
  await clearConversations(owner.id)
})

afterAll(async () => {
  const results = await Promise.allSettled(
    [owner, stranger]
      .filter((actor): actor is Actor => actor !== undefined)
      .map((actor) => admin.auth.admin.deleteUser(actor.id)),
  )

  for (const result of results) {
    if (result.status === 'rejected') {
      console.error('[tests/conversation-lifecycle] could not delete a fixture user', result.reason)
    }
  }
}, 30_000)

describeHosted('createConversation', () => {
  it('creates a row named by the column default, for feature 10 to replace', async () => {
    const id = await createConversation(owner.id, {
      provider: 'google',
      modelId: 'gemini-3.6-flash',
    })

    const row = await readRow(id)
    expect(row?.title).toBe(DEFAULT_CONVERSATION_TITLE)
    expect(row?.user_id).toBe(owner.id)
  })

  it('stores no system prompt when the caller does not supply one', async () => {
    const id = await createConversation(owner.id, {
      provider: 'google',
      modelId: 'gemini-3.6-flash',
    })

    expect((await readRow(id))?.system_prompt).toBeNull()
  })

  it('persists a system prompt travelling with the first message', async () => {
    // The one moment a system prompt may arrive from a request body: on /chat
    // there is no row to PATCH yet. Honouring it anywhere else would turn a
    // stored instruction into a silent per-request override. (F23)
    const id = await createConversation(
      owner.id,
      { provider: 'google', modelId: 'gemini-3.6-flash' },
      'Answer only in haiku',
    )

    expect((await readRow(id))?.system_prompt).toBe('Answer only in haiku')
  })
})

describeHosted('getConversation', () => {
  it('returns the caller’s own row', async () => {
    const id = await seedConversation(owner.id)

    expect((await getConversation(id))?.id).toBe(id)
  })

  it('returns null for a conversation belonging to someone else', async () => {
    // RLS makes it invisible rather than forbidden, so "not yours" and "does not
    // exist" arrive here identically — which is what lets callers answer 404 to
    // both without disclosing that the id is real.
    const theirs = await seedConversation(stranger.id)

    expect(await getConversation(theirs)).toBeNull()
  })
})

describeHosted('listConversations', () => {
  it('puts pinned rows first, then the most recently active', async () => {
    await seedConversation(owner.id, {
      title: 'old',
      updated_at: '2026-01-01T00:00:00.000Z',
    })
    await seedConversation(owner.id, {
      title: 'recent',
      updated_at: '2026-08-01T00:00:00.000Z',
    })
    await seedConversation(owner.id, {
      title: 'pinned but stale',
      updated_at: '2025-01-01T00:00:00.000Z',
      pinned_at: '2026-02-01T00:00:00.000Z',
    })

    const rows = await listConversations()

    expect(rows.map((row) => row.title)).toEqual(['pinned but stale', 'recent', 'old'])
  })

  it('hides archived rows by default and includes them when asked', async () => {
    // The flag widens and never narrows: one that filtered the other way round
    // would hide LIVE conversations, the single failure here that would look
    // like data loss. (F22)
    await seedConversation(owner.id, { title: 'live' })
    await seedConversation(owner.id, {
      title: 'filed',
      archived_at: '2026-07-01T00:00:00.000Z',
    })

    expect((await listConversations()).map((row) => row.title)).toEqual(['live'])
    expect((await listConversations(true)).map((row) => row.title).sort()).toEqual([
      'filed',
      'live',
    ])
  })

  it('does not carry the system prompt into the sidebar payload', async () => {
    // Up to ten thousand characters the sidebar has no use for, on an origin
    // with no CDN in front of it. (F06)
    await seedConversation(owner.id, { system_prompt: 'x'.repeat(5000) })

    const [row] = await listConversations()

    expect(row).not.toHaveProperty('system_prompt')
    expect(JSON.stringify(row)).not.toContain('xxxxx')
  })

  it('shows the caller none of another user’s conversations', async () => {
    await seedConversation(stranger.id, { title: 'theirs' })
    await seedConversation(owner.id, { title: 'mine' })

    expect((await listConversations()).map((row) => row.title)).toEqual(['mine'])
  })
})

describeHosted('updateConversationModel', () => {
  it('records the provider and the model together', async () => {
    // Selection is keyed on the PAIR, never the id alone: the same model appears
    // under two providers with different ids and different bills. (F15)
    const id = await seedConversation(owner.id)

    expect(
      await updateConversationModel(id, {
        provider: 'openrouter',
        modelId: 'anthropic/claude-sonnet-5',
      }),
    ).toBe(true)

    const row = await readRow(id)
    expect(row?.provider).toBe('openrouter')
    expect(row?.model_id).toBe('anthropic/claude-sonnet-5')
  })

  it('reports false for a conversation the caller does not own, and changes nothing', async () => {
    const theirs = await seedConversation(stranger.id)

    expect(
      await updateConversationModel(theirs, {
        provider: 'openai',
        modelId: 'planted',
      }),
    ).toBe(false)

    expect((await readRow(theirs))?.model_id).toBe('gemini-3.6-flash')
  })

  it('leaves updated_at alone, because changing the model is not activity', async () => {
    const id = await seedConversation(owner.id, {
      updated_at: '2025-01-01T00:00:00.000Z',
    })

    await updateConversationModel(id, {
      provider: 'google',
      modelId: 'gemini-3.5-flash',
    })

    expect((await readRow(id))?.updated_at).toBe('2025-01-01T00:00:00+00:00')
  })
})

describeHosted('touchConversation', () => {
  it('moves updated_at, which is the only thing keeping the sidebar honest', async () => {
    // There is no trigger on this column. Skip the touch and every conversation
    // keeps its creation time forever, with nothing to indicate why the list
    // stopped reordering.
    const id = await seedConversation(owner.id, {
      updated_at: '2025-01-01T00:00:00.000Z',
    })

    await touchConversation(id)

    const after = await readRow(id)
    expect(new Date(after?.updated_at ?? 0).getTime()).toBeGreaterThan(
      new Date('2025-01-01T00:00:00.000Z').getTime(),
    )
  })

  it('cannot touch a conversation the caller does not own', async () => {
    const theirs = await seedConversation(stranger.id, {
      updated_at: '2025-01-01T00:00:00.000Z',
    })

    await touchConversation(theirs)

    expect((await readRow(theirs))?.updated_at).toBe('2025-01-01T00:00:00+00:00')
  })
})

describeHosted('shareConversation', () => {
  it('mints an unguessable slug of the documented length', async () => {
    const id = await seedConversation(owner.id)

    const slug = await shareConversation(id)

    expect(slug).toHaveLength(SHARE_SLUG_LENGTH)
    expect((await readRow(id))?.shared_at).not.toBeNull()
  })

  it('returns the existing slug on a second call, so a pasted link keeps working', async () => {
    // Desired state, like pin and archive. A second click that minted a new slug
    // would silently break a URL somebody had already sent to someone.
    const id = await seedConversation(owner.id)

    const first = await shareConversation(id)
    const second = await shareConversation(id)

    expect(second).toBe(first)
  })

  it('mints a NEW slug after a revoke, so the old URL is never reinstated', async () => {
    const id = await seedConversation(owner.id)

    const first = await shareConversation(id)
    await unshareConversation(id)
    const second = await shareConversation(id)

    expect(second).not.toBe(first)
    expect(second).toHaveLength(SHARE_SLUG_LENGTH)
  })

  it('returns null for a conversation the caller does not own', async () => {
    const theirs = await seedConversation(stranger.id)

    expect(await shareConversation(theirs)).toBeNull()
    expect((await readRow(theirs))?.share_slug).toBeNull()
  })

  it('leaves updated_at alone, because sharing is not activity', async () => {
    const id = await seedConversation(owner.id, {
      updated_at: '2025-01-01T00:00:00.000Z',
    })

    await shareConversation(id)

    expect((await readRow(id))?.updated_at).toBe('2025-01-01T00:00:00+00:00')
  })
})

describeHosted('unshareConversation', () => {
  it('nulls both columns, which is the whole of revocation', async () => {
    // Nothing is invalidated and no cache is cleared: the anon policy reads
    // `share_slug is not null`, so there is simply nothing left to match.
    const id = await seedConversation(owner.id)
    await shareConversation(id)

    expect(await unshareConversation(id)).toBe(true)

    const row = await readRow(id)
    expect(row?.share_slug).toBeNull()
    expect(row?.shared_at).toBeNull()
  })

  it('returns false for a conversation the caller does not own, and leaves it shared', async () => {
    const theirs = await seedConversation(stranger.id, {
      share_slug: `f35keep${crypto.randomUUID().slice(0, 5)}`,
      shared_at: new Date().toISOString(),
    })

    expect(await unshareConversation(theirs)).toBe(false)
    expect((await readRow(theirs))?.share_slug).not.toBeNull()
  })
})

describeHosted('deleteConversation', () => {
  it('removes the row and reports that it did', async () => {
    const id = await seedConversation(owner.id)

    expect(await deleteConversation(id)).toBe(true)
    expect(await readRow(id)).toBeNull()
  })

  it('reports false for a conversation the caller does not own, and leaves it there', async () => {
    // A write RLS filters out looks exactly like a successful no-op, which is
    // why this returns a row count rather than trusting the absence of an error.
    const theirs = await seedConversation(stranger.id)

    expect(await deleteConversation(theirs)).toBe(false)
    expect(await readRow(theirs)).not.toBeNull()
  })

  it('takes the conversation’s messages with it', async () => {
    const id = await seedConversation(owner.id)
    await admin
      .from('messages')
      .insert({ conversation_id: id, user_id: owner.id, role: 'user', content: 'hi' })

    await deleteConversation(id)

    const { data } = await admin.from('messages').select('id').eq('conversation_id', id)
    expect(data).toEqual([])
  })
})
