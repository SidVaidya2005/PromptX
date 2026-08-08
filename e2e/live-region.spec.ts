import { expect, test } from '@playwright/test'

import { mockChatStream } from './support/mock-chat'
import {
  adminClient,
  createActor,
  deleteActors,
  retryOnClockSkew,
  type Actor,
} from './support/session'

/**
 * What a screen reader is actually told while an answer is generated. (F37)
 *
 * Part of the audit suite rather than a sixth flow spec: it checks one
 * accessibility property of the streaming path, and like the axe sweep it is
 * something no unit test here can reach.
 *
 * **The count is the assertion.** A live region that announces correctly and one
 * that announces fifty times both contain the right words at the end, so a test
 * reading only the final contents cannot tell them apart — and fifty is the
 * failure, because a polite region queues rather than replaces and the reader
 * hears the whole backlog. So the region's text is sampled throughout the
 * stream and the distinct values are counted.
 */

let actor: Actor
let conversationId: string

test.beforeAll(async () => {
  await retryOnClockSkew(async () => {
    actor = await createActor('live')

    const { data, error } = await adminClient()
      .from('conversations')
      .insert({
        user_id: actor.id,
        title: 'Live region fixture',
        provider: 'google',
        model_id: 'gemini-3.6-flash',
      })
      .select('id')
      .single()

    if (error) throw error
    conversationId = data.id
  })
})

test.afterAll(async () => {
  await deleteActors([actor])
})

test('announces that generation started, then the settled answer, and nothing between', async ({
  page,
  context,
}) => {
  const mock = await mockChatStream(page, {
    words: ['Objects ', 'first, ', 'then ', 'the ', 'rows.'],
    delayMs: 200,
  })

  try {
    await context.addCookies(actor.cookies)
    await page.goto(`/chat/${conversationId}`)

    const region = page.locator('p[role="status"][aria-live="polite"]')

    await page.getByRole('textbox', { name: 'Message' }).fill('What gets deleted first?')
    await page.getByRole('button', { name: 'Send message' }).click()

    const spoken = new Set<string>()

    await expect(async () => {
      for (const text of await region.allInnerTexts()) {
        if (text.trim().length > 0) spoken.add(text.trim())
      }
      expect([...spoken].some((line) => line.startsWith('Response complete'))).toBe(true)
    }).toPass({ timeout: 15_000, intervals: [50] })

    // Five deltas arrived. A live region wrapped around the streaming text would
    // have produced an announcement per delta; this one produces two.
    expect(
      [...spoken],
      'the region should announce the start and the result, not every delta',
    ).toHaveLength(2)

    expect(spoken.has('Generating response')).toBe(true)
    expect([...spoken].at(-1)).toContain('Objects first, then the rows.')

    expect(mock.hits()).toBe(1)
  } finally {
    await mock.close()
  }
})

test('marks the thread busy while it streams, and settled afterwards', async ({
  page,
  context,
}) => {
  const mock = await mockChatStream(page, { words: ['One. ', 'Two.'], delayMs: 400 })

  try {
    await context.addCookies(actor.cookies)
    await page.goto(`/chat/${conversationId}`)

    const thread = page.locator('[aria-busy]').first()
    await expect(thread).toHaveAttribute('aria-busy', 'false')

    await page.getByRole('textbox', { name: 'Message' }).fill('Count to two')
    await page.getByRole('button', { name: 'Send message' }).click()

    // Busy while the answer is half-written, so a reader navigating into it is
    // told it is still changing rather than reading a truncated sentence as
    // though it were the whole reply.
    await expect(thread).toHaveAttribute('aria-busy', 'true')
    await expect(thread).toHaveAttribute('aria-busy', 'false', { timeout: 15_000 })
  } finally {
    await mock.close()
  }
})
