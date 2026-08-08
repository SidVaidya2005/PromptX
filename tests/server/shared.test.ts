import { createClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'

import { getSharedConversation } from '@/server/data/shared'

import type { Database } from '@/types/database'

import { requiredEnv } from '../support/env'
import { describeHosted } from '../support/hosted'

/**
 * The public read path, exercised as a stranger actually reaches it.
 *
 * Nothing is mocked here at all — `getSharedConversation` builds its own
 * anonymous client, which is the entire security model of `/share/[slug]`: no
 * session, so PostgREST resolves the role to `anon`, so only F03's three share
 * policies apply. Substituting a client would replace the thing under test.
 *
 * Two properties carry most of the weight. **Revocation is immediate by
 * construction** — the anon policy asks whether `share_slug is not null`, so
 * nulling the column closes the conversation, its messages and its attachment
 * metadata in one write, with no cache to clear. And **the payload is picked
 * field by field**, which is the F34 rule doing security work: a spread of either
 * row would publish `user_id`, the token counts and `used_shared_key` to anyone
 * holding the link, and would silently begin publishing any column added later.
 * That one is asserted against the SERIALISED payload, because what it guards
 * against is a field nobody thought to name.
 */

const SUPABASE_URL = requiredEnv('NEXT_PUBLIC_SUPABASE_URL')
const SECRET_KEY = requiredEnv('SUPABASE_SECRET_KEY')

const admin = createClient<Database>(SUPABASE_URL, SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

let userId: string
let conversationId: string
let slug: string
let promptId: string

async function insertMessage(
  role: 'user' | 'assistant',
  content: string,
  extra: { status?: 'streaming' | 'complete' | 'error'; modelId?: string } = {},
): Promise<string> {
  const { data, error } = await admin
    .from('messages')
    .insert({
      conversation_id: conversationId,
      user_id: userId,
      role,
      content,
      status: extra.status ?? 'complete',
      provider: role === 'assistant' ? 'google' : null,
      model_id: role === 'assistant' ? (extra.modelId ?? 'gemini-3.6-flash') : null,
      used_shared_key: role === 'assistant',
      input_tokens: role === 'assistant' ? 412 : null,
      output_tokens: role === 'assistant' ? 77 : null,
    })
    .select('id')
    .single()

  if (error) throw error
  return data.id
}

async function setSlug(value: string | null) {
  const { error } = await admin
    .from('conversations')
    .update({ share_slug: value, shared_at: value ? new Date().toISOString() : null })
    .eq('id', conversationId)

  if (error) throw error
}

beforeAll(async () => {
  const email = `shared-${crypto.randomUUID()}@promptx.test`

  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password: crypto.randomUUID(),
    email_confirm: true,
  })

  if (error || !created.user) throw new Error(`could not create owner: ${error?.message}`)
  userId = created.user.id

  slug = `f35${crypto.randomUUID().replace(/-/g, '').slice(0, 9)}`

  const { data: conversation, error: conversationError } = await admin
    .from('conversations')
    .insert({
      user_id: userId,
      title: 'A shared thread',
      provider: 'google',
      model_id: 'gemini-3.6-flash',
      share_slug: slug,
      shared_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (conversationError) throw conversationError
  conversationId = conversation.id

  // One at a time: a batch insert shares a transaction and therefore one now(),
  // and the ordering asserted below needs the rows to differ.
  promptId = await insertMessage('user', 'What does the reaper delete?')
  await insertMessage('assistant', 'Objects first, then rows.')

  const { error: attachmentError } = await admin.from('attachments').insert({
    user_id: userId,
    message_id: promptId,
    position: 0,
    storage_path: `${userId}/${crypto.randomUUID()}.png`,
    mime_type: 'image/png',
    size_bytes: 2048,
    status: 'ready',
  })

  if (attachmentError) throw attachmentError
}, 30_000)

beforeEach(async () => {
  await setSlug(slug)
})

afterAll(async () => {
  const result = await admin.auth.admin.deleteUser(userId)
  if (result.error) {
    console.error('[tests/shared] could not delete the fixture user', result.error)
  }
}, 30_000)

describeHosted('getSharedConversation', () => {
  it('returns the thread in order for a live slug', async () => {
    const shared = await getSharedConversation(slug)

    expect(shared?.title).toBe('A shared thread')
    expect(shared?.messages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
    ])
    expect(shared?.messages[1]?.content).toBe('Objects first, then rows.')
  })

  it('keeps the model that wrote each answer, which is the interesting part', async () => {
    const shared = await getSharedConversation(slug)

    expect(shared?.messages[0]?.modelId).toBeNull()
    expect(shared?.messages[1]?.modelId).toBe('gemini-3.6-flash')
  })

  it('returns null for a slug that never existed', async () => {
    expect(await getSharedConversation('nosuchslug123')).toBeNull()
  })

  it('returns null the moment the slug is revoked, with nothing to invalidate', async () => {
    await setSlug(null)

    expect(await getSharedConversation(slug)).toBeNull()
  })

  it('publishes attachment metadata and never anything that could fetch the bytes', async () => {
    const shared = await getSharedConversation(slug)
    const attachment = shared?.messages[0]?.attachments[0]

    expect(attachment?.mimeType).toBe('image/png')
    expect(attachment?.position).toBe(0)
    // The placeholder exists precisely so the page never needs a signed URL. A
    // storage path reaching the client is the first half of leaking one.
    expect(attachment).not.toHaveProperty('storagePath')
    expect(attachment).not.toHaveProperty('storage_path')
  })

  it('hides a message still marked streaming', async () => {
    // A row stuck in `streaming` belongs to a generation that died, and holds
    // whatever partial text arrived. Publishing a half-sentence the owner never
    // saw finish is different from handing them their own record, which is why
    // F34's export keeps these and this does not.
    const abandonedId = await insertMessage('assistant', 'half a sen', {
      status: 'streaming',
    })

    const shared = await getSharedConversation(slug)

    expect(shared?.messages.map((message) => message.id)).not.toContain(abandonedId)
    expect(shared?.messages).toHaveLength(2)

    await admin.from('messages').delete().eq('id', abandonedId)
  })

  it('publishes no owner id, no token counts and no key usage', async () => {
    // Asserted against the serialised payload rather than field by field,
    // because the risk is a column nobody thought to name — the F34 rule. A
    // spread of either row turns this red.
    const shared = await getSharedConversation(slug)
    const payload = JSON.stringify(shared)

    expect(payload).not.toContain(userId)
    expect(payload).not.toContain('user_id')
    expect(payload).not.toContain('used_shared_key')
    expect(payload).not.toContain('input_tokens')
    expect(payload).not.toContain('412')
    expect(payload).not.toContain('share_slug')
    expect(payload).not.toContain(slug)
  })
})
