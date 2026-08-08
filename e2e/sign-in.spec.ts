import { expect, test } from '@playwright/test'

import { createActor, deleteActors, type Actor } from './support/session'

/**
 * The session boundary, from both sides.
 *
 * There is no consent screen here and there cannot be one: sign-in is Google
 * OAuth only, a headless browser cannot complete Google's consent flow, and a
 * real test account would mean fighting bot detection instead of proving
 * anything about this application. `library-docs.md` settles it — seed the user,
 * inject the session.
 *
 * What is left is the part the application actually owns, and it is the part
 * that can break: the redirects. Both directions are asserted, because each has
 * its own failure mode. An unauthenticated visitor reaching `/chat` is a
 * privacy failure; a signed-in visitor stuck on the landing page is a product
 * that appears broken to the only people who have signed up for it.
 *
 * Route protection is enforced in two independent places by design — the `(app)`
 * layout and every route handler — and `src/proxy.ts` is explicitly not one of
 * them. This spec exercises the layout half through a real browser, which no
 * unit test in `tests/` reaches.
 */

let actor: Actor

test.beforeAll(async () => {
  actor = await createActor('signin')
})

test.afterAll(async () => {
  await deleteActors([actor])
})

test.describe('signed out', () => {
  test('is sent from the workspace to the landing page', async ({ page }) => {
    await page.goto('/chat')

    await expect(page).toHaveURL('/')
  })

  test('is sent away from settings too, not just from chat', async ({ page }) => {
    // Every `(app)` route is covered by one layout guard, so this is the check
    // that the guard is on the LAYOUT rather than on one page.
    await page.goto('/settings/keys')

    await expect(page).toHaveURL('/')
  })

  test('is offered the only way in', async ({ page }) => {
    await page.goto('/')

    await expect(
      page.getByRole('button', { name: 'Continue with Google' }),
    ).toBeVisible()
  })
})

test.describe('signed in', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('is sent from the landing page into the workspace', async ({ page, context }) => {
    await context.addCookies(actor.cookies)

    await page.goto('/')

    await expect(page).toHaveURL('/chat')
  })

  test('reaches the workspace shell with a working composer', async ({ page, context }) => {
    // Proves the injected session is genuinely accepted by the server render —
    // not merely that a redirect fired. If the cookies were malformed the page
    // would bounce back to `/`, so landing here with the composer present is the
    // fixture's real acceptance test.
    await context.addCookies(actor.cookies)

    await page.goto('/chat')

    await expect(page).toHaveURL('/chat')
    await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible()
  })
})
