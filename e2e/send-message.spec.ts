import { expect, test } from '@playwright/test'

import { mockChatStream } from './support/mock-chat'
import { adminClient, createActor, deleteActors, type Actor } from './support/session'

/**
 * Type a message, watch an answer arrive a piece at a time.
 *
 * **What this proves, stated plainly, because the boundary matters.** `/api/chat`
 * is intercepted, so nothing here exercises the server pipeline — quota
 * reservation, provider resolution, persistence and token accounting are all
 * covered by the 619 tests in `tests/`, several of them against the real
 * database. What no unit test in this project can reach is the rendering path:
 * `vitest.config.ts` runs a node environment over `tests/**` and can see nothing
 * rendered. So this spec owns exactly one claim — that a stream of deltas
 * becomes text appearing incrementally on screen — and it is the only place that
 * claim is checked at all.
 *
 * The spec starts on a conversation that already exists rather than on `/chat`.
 * Sending the first message of a new conversation makes the server report which
 * row the prompt became, through a transient `data-conversation` part that
 * drives a redirect; a canned stream would have to reproduce that, coupling this
 * fixture to a second internal protocol detail for no gain. The user-visible
 * behaviour under test is identical either way.
 */

const PROMPT = 'What does the reaper delete first?'

let actor: Actor
let conversationId: string

test.beforeAll(async () => {
  actor = await createActor('send')

  const { data, error } = await adminClient()
    .from('conversations')
    .insert({
      user_id: actor.id,
      title: 'Streaming fixture',
      provider: 'google',
      model_id: 'gemini-3.6-flash',
    })
    .select('id')
    .single()

  if (error) throw error
  conversationId = data.id
})

test.afterAll(async () => {
  await deleteActors([actor])
})

test('an answer arrives a piece at a time', async ({ page, context }) => {
  const mock = await mockChatStream(page, {
    words: ['Objects ', 'first, ', 'then the rows.'],
    delayMs: 300,
  })

  try {
    await context.addCookies(actor.cookies)
    await page.goto(`/chat/${conversationId}`)

    await page.getByRole('textbox', { name: 'Message' }).fill(PROMPT)
    await page.getByRole('button', { name: 'Send message' }).click()

    // The prompt is on screen before any answer is, which is what makes the
    // composer feel responsive on a cold provider.
    await expect(page.getByText(PROMPT)).toBeVisible()

    // Poll the thread while it streams and keep every distinct state that
    // contains part of the answer. Asserting only the final text would pass
    // just as happily against a single blob — the whole point here is that
    // there were intermediate states at all.
    const seen = new Set<string>()
    const thread = page.getByRole('main')

    await expect(async () => {
      const text = await thread.innerText()
      const answer = text.slice(text.indexOf('Objects'))
      if (text.includes('Objects')) seen.add(answer.trim())
      expect(text).toContain('then the rows.')
    }).toPass({ timeout: 15_000, intervals: [100] })

    expect(
      seen.size,
      'the answer should have been observed part-written at least once before it completed',
    ).toBeGreaterThan(1)

    await expect(thread).toContainText('Objects first, then the rows.')

    // An interception that never fired would mean this spec had quietly reached
    // the real route, spending a shared-key slot and real money.
    expect(mock.hits()).toBe(1)
  } finally {
    await mock.close()
  }
})

test('the composer clears itself and comes back ready', async ({ page, context }) => {
  const mock = await mockChatStream(page, { words: ['Done.'], delayMs: 50 })

  try {
    await context.addCookies(actor.cookies)
    await page.goto(`/chat/${conversationId}`)

    const composer = page.getByRole('textbox', { name: 'Message' })
    await composer.fill('Second question')
    await page.getByRole('button', { name: 'Send message' }).click()

    // A composer that keeps the sent text is how people send the same message
    // twice, and the send button returning is what says the turn is over.
    await expect(composer).toHaveValue('')
    await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible()
    expect(mock.hits()).toBe(1)
  } finally {
    await mock.close()
  }
})
