import { expect, test } from '@playwright/test'

import { SHARED_KEY_DAILY_MESSAGE_LIMIT } from '@/lib/constants'

import { adminClient, createActor, deleteActors, type Actor } from './support/session'

/**
 * The wall a user without their own key meets one message past the cap.
 *
 * Every figure here is derived from `SHARED_KEY_DAILY_MESSAGE_LIMIT` rather than
 * written out, because that number is configuration and has already moved once:
 * F38 took it from 20 to 5 when the shared key turned out to be on a free tier
 * granting twenty requests a *day* across all users, not per user.
 *
 * `tests/server/quota.test.ts` already proves the rule where it is enforced: the
 * last two claims succeed, the one past the cap is refused, and the claim is a
 * single atomic statement rather than a read followed by a write. None of that is what
 * this spec is for. What no test in `tests/` can see is whether the person is
 * *told* — whether the composer actually locks and says why, or silently accepts
 * a message the server will refuse.
 *
 * No interception anywhere. Every page in the workspace reads `getTodaysUsage()`
 * during its server render, so seeding the row and loading the page is the
 * entire test — nothing here calls a provider, and the composer never gets far
 * enough to try.
 *
 * Both sides of the boundary are asserted, and that is the point rather than
 * thoroughness for its own sake: a composer that locks one message early is a
 * feature quietly taking something from people, and it would look identical to a
 * correct one in any test that only checked the locked state.
 */

const USAGE_DATE = new Date().toISOString().slice(0, 10)

let actor: Actor

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  actor = await createActor('quota')
})

test.afterAll(async () => {
  await deleteActors([actor])
})

async function setUsage(messageCount: number): Promise<void> {
  const { error } = await adminClient()
    .from('shared_key_usage')
    .upsert(
      { user_id: actor.id, usage_date: USAGE_DATE, message_count: messageCount },
      { onConflict: 'user_id,usage_date' },
    )

  if (error) throw error
}

test('leaves the composer usable on the last free message', async ({ page, context }) => {
  await setUsage(SHARED_KEY_DAILY_MESSAGE_LIMIT - 1)

  await context.addCookies(actor.cookies)
  await page.goto('/chat')

  await expect(page.getByRole('textbox', { name: 'Message' })).toBeEnabled()
  await expect(
    page.getByText(
      `1 of ${SHARED_KEY_DAILY_MESSAGE_LIMIT} free messages left today`,
    ),
  ).toBeVisible()
})

test('locks the composer and says why once the allowance is spent', async ({ page, context }) => {
  await setUsage(SHARED_KEY_DAILY_MESSAGE_LIMIT)

  await context.addCookies(actor.cookies)
  await page.goto('/chat')

  // The sentence is a stated success criterion in project-overview.md, so it is
  // asserted as text rather than by the presence of some disabled attribute.
  // The apostrophe is the typographic one the component renders.
  await expect(
    page.getByText(`You’ve used your ${SHARED_KEY_DAILY_MESSAGE_LIMIT} free messages for today.`),
  ).toBeVisible()

  await expect(page.getByRole('textbox', { name: 'Message' })).toBeDisabled()

  // A wall with no way past it is a dead end. The link out is part of the
  // message, not decoration.
  await expect(page.getByRole('link', { name: 'Add your own API key' })).toBeVisible()
})

test('offers the meter’s spent state rather than a bare number', async ({ page, context }) => {
  await setUsage(SHARED_KEY_DAILY_MESSAGE_LIMIT)

  await context.addCookies(actor.cookies)
  await page.goto('/chat')

  await expect(page.getByText('No free messages left today')).toBeVisible()
})

test('the wall follows the user into an existing conversation', async ({ page, context }) => {
  // The composer is the same component everywhere, but the usage read happens
  // per page — `/chat` and `/chat/[id]` each call getTodaysUsage() in their own
  // server render, so a page that forgot to would show an unlocked composer on
  // a spent allowance.
  await setUsage(SHARED_KEY_DAILY_MESSAGE_LIMIT)

  const { data, error } = await adminClient()
    .from('conversations')
    .insert({
      user_id: actor.id,
      title: 'Quota fixture',
      provider: 'google',
      model_id: 'gemini-3.6-flash',
    })
    .select('id')
    .single()

  if (error) throw error

  await context.addCookies(actor.cookies)
  await page.goto(`/chat/${data.id}`)

  await expect(page.getByRole('textbox', { name: 'Message' })).toBeDisabled()
  await expect(
    page.getByText(`You’ve used your ${SHARED_KEY_DAILY_MESSAGE_LIMIT} free messages for today.`),
  ).toBeVisible()
})
