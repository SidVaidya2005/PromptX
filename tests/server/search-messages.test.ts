import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { SEARCH_MATCH_END, SEARCH_MATCH_START, SEARCH_RESULT_LIMIT } from '@/lib/constants'

import type { Database } from '@/types/database'

import { requiredEnv } from '../support/env'

/**
 * `search_messages`, against the real hosted project. (F26)
 *
 * `messages.search_vector` and `messages_search_idx` have existed since F02 and
 * nothing has ever queried them, so this suite is the first thing to exercise
 * either.
 *
 * **`build-plan.md` §26 asks for a sub-500ms wall-clock assertion over 5,000
 * messages and this suite deliberately does not make one.** There is no local
 * stack: the timing measured here would be a round trip from a laptop to
 * ap-southeast-1, so it would be green with a bad plan on a fast connection and
 * red with a good plan on a slow one — a number that moves for reasons the code
 * cannot cause. F16 established what a test that cannot fail is worth, and this
 * is the same shape. The 5,000 rows are still seeded, because they are what
 * makes the planner choose a realistic plan; the speed claim is answered with
 * `EXPLAIN ANALYZE` against this data and recorded in `build-journal.md`.
 *
 * What *is* asserted here is everything a wall-clock number would not have
 * caught: ranking, the total order, the cap, isolation, the plain-text snippet,
 * and the difference between "no matches" and "nothing to match on".
 */

const SUPABASE_URL = requiredEnv('NEXT_PUBLIC_SUPABASE_URL')
const PUBLISHABLE_KEY = requiredEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY')
const SECRET_KEY = requiredEnv('SUPABASE_SECRET_KEY')

const admin = createClient<Database>(SUPABASE_URL, SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

type Actor = {
  id: string
  client: SupabaseClient<Database>
}

let owner: Actor
let stranger: Actor

/** Whose session the data module will see on the next `load()`. */
let current: SupabaseClient<Database>

let ownerConversation: string
let archivedConversation: string

type MessagesModule = typeof import('@/server/data/messages')

async function load(actor: Actor): Promise<MessagesModule> {
  current = actor.client

  vi.resetModules()
  vi.doMock('@/server/supabase', () => ({
    createServerSupabaseClient: async () => current,
  }))

  return import('@/server/data/messages')
}

async function createActor(label: string): Promise<Actor> {
  const email = `search-${label}-${crypto.randomUUID()}@promptx.test`
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

  const { error: signInError } = await client.auth.signInWithPassword({
    email,
    password,
  })

  if (signInError) throw new Error(`could not sign in ${label}: ${signInError.message}`)

  return { id: created.user.id, client }
}

async function seedConversation(
  userId: string,
  title: string,
  archived = false,
): Promise<string> {
  const { data, error } = await admin
    .from('conversations')
    .insert({
      user_id: userId,
      title,
      provider: 'google',
      model_id: 'gemini-3.6-flash',
      archived_at: archived ? new Date().toISOString() : null,
    })
    .select('id')
    .single()

  if (error) throw error
  return data.id
}

/**
 * Seeded with the service-role client, so a broken policy cannot empty the
 * fixture and make every isolation assertion pass for the wrong reason. (F03)
 */
async function seedMessages(
  userId: string,
  conversationId: string,
  contents: string[],
  createdAt?: string,
): Promise<void> {
  // Batched, because 5,000 rows in one statement is a request body large enough
  // to be refused and slow enough to time out. 500 is comfortably under both.
  const BATCH = 500

  for (let start = 0; start < contents.length; start += BATCH) {
    const rows = contents.slice(start, start + BATCH).map((content) => ({
      user_id: userId,
      conversation_id: conversationId,
      role: 'user' as const,
      content,
      ...(createdAt ? { created_at: createdAt } : {}),
    }))

    const { error } = await admin.from('messages').insert(rows)
    if (error) throw error
  }
}

/**
 * 5,000 messages of filler plus the handful the assertions actually name.
 *
 * The filler is what makes the planner's choice realistic — at a few hundred
 * rows Postgres may prefer a sequential scan, so a plan measured there would
 * describe something the application never runs. The words are drawn from a
 * small vocabulary so the index has a believable distribution rather than 5,000
 * unique terms.
 */
const FILLER_WORDS = [
  'deployment pipeline configuration',
  'database migration rollback',
  'typescript compiler options',
  'react component lifecycle',
  'network latency measurement',
]

beforeAll(async () => {
  ;[owner, stranger] = await Promise.all([createActor('owner'), createActor('stranger')])

  ownerConversation = await seedConversation(owner.id, 'Search fixture')
  archivedConversation = await seedConversation(owner.id, 'Archived fixture', true)

  const filler = Array.from(
    { length: 5_000 },
    (_, index) => `${FILLER_WORDS[index % FILLER_WORDS.length]} number ${index}`,
  )

  await seedMessages(owner.id, ownerConversation, filler)

  // The rows the assertions name. `zylophone` is a deliberate non-word so no
  // filler row can match it by accident.
  await seedMessages(owner.id, ownerConversation, [
    'zylophone zylophone zylophone repeated many times over',
    'a single mention of zylophone here',
    'an <img src=x onerror=alert(1)> tag beside the word zylophone',
  ])

  await seedMessages(owner.id, archivedConversation, [
    'this archived message mentions zylophone too',
  ])

  // Someone else's matching row, which must never appear for the owner.
  const strangerConversation = await seedConversation(stranger.id, 'Not yours')
  await seedMessages(stranger.id, strangerConversation, [
    'the stranger also wrote zylophone',
  ])
}, 180_000)

afterAll(async () => {
  // allSettled, not all — one rejected delete discards the other's outcome and
  // leaves a fixture user, and 5,000 messages, on a project with no reset. (F19)
  const results = await Promise.allSettled(
    [owner, stranger]
      .filter((actor): actor is Actor => actor !== undefined)
      .map((actor) => admin.auth.admin.deleteUser(actor.id)),
  )

  for (const result of results) {
    if (result.status === 'rejected') {
      console.error('[tests/search-messages] could not delete a fixture user', result.reason)
    }
  }
}, 120_000)

async function search(actor: Actor, query: string) {
  const data = await load(actor)
  return data.searchMessages(query)
}

describe('searchMessages', () => {
  it('ranks a message that repeats the term above one that mentions it once', async () => {
    const outcome = await search(owner, 'zylophone')

    expect(outcome.status).toBe('ok')
    if (outcome.status !== 'ok') return

    const contents = outcome.results.map((result) => result.snippet)
    const repeated = contents.findIndex((snippet) => snippet.includes('repeated many'))
    const single = contents.findIndex((snippet) => snippet.includes('single mention'))

    expect(repeated).toBeGreaterThanOrEqual(0)
    expect(single).toBeGreaterThanOrEqual(0)
    expect(repeated).toBeLessThan(single)
  })

  it('returns the same order twice, because the order is total', async () => {
    // ts_rank ties are ordinary — far more so than the created_at ties F19 had
    // to make total — so without the tiebreakers the same query can come back
    // shuffled and any paging on top of it would be unstable.
    const first = await search(owner, 'deployment pipeline')
    const second = await search(owner, 'deployment pipeline')

    expect(first.status).toBe('ok')
    if (first.status !== 'ok' || second.status !== 'ok') return

    expect(first.results.map((r) => r.message_id)).toEqual(
      second.results.map((r) => r.message_id),
    )
  })

  it('caps the result set at SEARCH_RESULT_LIMIT', async () => {
    // 'deployment' matches 1,000 filler rows.
    const outcome = await search(owner, 'deployment')

    expect(outcome.status).toBe('ok')
    if (outcome.status !== 'ok') return

    expect(outcome.results).toHaveLength(SEARCH_RESULT_LIMIT)
  })

  it("never returns another user's message, with no user_id anywhere in the path", async () => {
    // searchMessages() takes no user id and the function has no such parameter.
    // Two policies scope this rather than one: `messages` hides the row and
    // `conversations` hides the row it joins to, and because the join is inner,
    // either alone is sufficient. That was measured, not assumed — weakening
    // only the messages policy to `using (true)` left this whole suite green.
    //
    // **Asserted on `conversation_title`, never on the snippet.** The first
    // version of this test looked for the stranger's wording inside the snippet
    // and could not fail: `ts_headline` returns a *fragment*, so the leading
    // words of a short message are routinely cut off, and the substring was
    // absent whether or not the row was there. The title comes off the row.
    const outcome = await search(owner, 'zylophone')

    expect(outcome.status).toBe('ok')
    if (outcome.status !== 'ok') return

    expect(outcome.results.length).toBeGreaterThan(0)
    expect(
      outcome.results.every((result) => result.conversation_title !== 'Not yours'),
    ).toBe(true)
  })

  it('finds nothing at all for a user with no messages', async () => {
    const outcome = await search(stranger, 'deployment pipeline')

    expect(outcome.status).toBe('ok')
    if (outcome.status !== 'ok') return

    // The stranger owns exactly one message and it does not mention this.
    expect(outcome.results).toHaveLength(0)
  })

  it('searches archived conversations, which F22 requires', async () => {
    const outcome = await search(owner, 'zylophone')

    expect(outcome.status).toBe('ok')
    if (outcome.status !== 'ok') return

    expect(
      outcome.results.some((result) => result.conversation_title === 'Archived fixture'),
    ).toBe(true)
  })

  it('wraps matches in the sentinels and emits no markup', async () => {
    const outcome = await search(owner, 'zylophone')

    expect(outcome.status).toBe('ok')
    if (outcome.status !== 'ok') return

    const [first] = outcome.results
    expect(first?.snippet).toContain(SEARCH_MATCH_START)
    expect(first?.snippet).toContain(SEARCH_MATCH_END)
    expect(first?.snippet).not.toContain('<mark>')
  })

  it('leaves HTML in a message as inert text rather than markup', async () => {
    // The reason the sentinels exist. ts_headline does not escape the document,
    // so an <img onerror> in a message survives it verbatim — measured before
    // this function was written. What makes that safe is that the snippet is
    // never HTML, so the tag is just characters and the only delimiters in the
    // string are ones a browser has never heard of.
    const outcome = await search(owner, 'zylophone')

    expect(outcome.status).toBe('ok')
    if (outcome.status !== 'ok') return

    const withTag = outcome.results.find((result) => result.snippet.includes('onerror'))

    expect(withTag).toBeDefined()
    // The <img is present as text — proof the snippet was not sanitised and
    // therefore proof that rendering it as HTML would have been the bug.
    expect(withTag?.snippet).toContain('onerror')
    // And the only delimiters around the match are ours, which are not brackets.
    expect(withTag?.snippet).toContain(`${SEARCH_MATCH_START}zylophone${SEARCH_MATCH_END}`)
  })

  it('reports a stopword-only query as having no terms, not as no matches', async () => {
    const outcome = await search(owner, 'the and of')

    expect(outcome.status).toBe('no_terms')
  })

  it('reports a real word that matches nothing as a search that found nothing', async () => {
    // The pair that matters: both return zero rows and they mean different
    // things, so the UI can say "try different words" or "nothing here".
    const outcome = await search(owner, 'chrysanthemum')

    expect(outcome.status).toBe('ok')
    if (outcome.status !== 'ok') return

    expect(outcome.results).toHaveLength(0)
  })

  it('short-circuits a blank query without a round trip', async () => {
    expect((await search(owner, '   ')).status).toBe('no_terms')
  })
})
