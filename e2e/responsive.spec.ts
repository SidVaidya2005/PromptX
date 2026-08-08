import { expect, test, type Locator, type Page } from '@playwright/test'

import { AUDIT_ROUTES } from './support/routes'
import {
  adminClient,
  createActor,
  deleteActors,
  retryOnClockSkew,
  type Actor,
} from './support/session'

/**
 * Every supported width, and the affordances a coarse pointer must still
 * reach. (F37)
 *
 * The widths are `DESIGN.md`'s own: 360 is the smallest phone the design
 * targets, 768 and 1024 are the two breakpoints (`tablet:` and `desktop:`), and
 * 1440 and 1920 are the desktop sizes. Note there are only **two** prefixes —
 * Tailwind's `sm:`/`md:`/`lg:`/`xl:` are deleted from the theme, and the failure
 * mode is silence rather than an error, so a stray `md:` generates nothing and
 * the style simply never applies.
 *
 * **The coarse-pointer case is separate from the widths on purpose**, because
 * `code-standards.md` says the two must never be substituted for each other: an
 * iPad in landscape is 1024px and gets the `desktop:` layout while having no
 * hover at all. Verified reachable: `hasTouch` makes Chromium report
 * `pointer: coarse` and `hover: none`, measured before this spec relied on it.
 *
 * What is asserted at each width is horizontal overflow, because that is the
 * failure that makes a layout unusable rather than merely ugly, and it is
 * objective — a screenshot comparison would need a baseline nobody can review.
 */

const WIDTHS = [360, 768, 1024, 1440, 1920] as const

let actor: Actor
let conversationId: string

test.beforeAll(async () => {
  await retryOnClockSkew(async () => {
    actor = await createActor('responsive')
    const admin = adminClient()

    const { data, error } = await admin
      .from('conversations')
      .insert({
        user_id: actor.id,
        title: 'Responsive fixture with a deliberately long title that must not overflow',
        provider: 'google',
        model_id: 'gemini-3.6-flash',
      })
      .select('id')
      .single()

    if (error) throw error
    conversationId = data.id

    for (const [role, content] of [
      ['user', 'A prompt long enough to wrap on a narrow screen rather than sit on one line'],
      [
        'assistant',
        'An answer with a long unbroken token — supercalifragilisticexpialidocious_'.concat(
          'x'.repeat(80),
        ),
      ],
    ] as const) {
      const { error: messageError } = await admin.from('messages').insert({
        conversation_id: conversationId,
        user_id: actor.id,
        role,
        content,
        provider: role === 'assistant' ? 'google' : null,
        model_id: role === 'assistant' ? 'gemini-3.6-flash' : null,
      })

      if (messageError) throw messageError
    }
  })
})

test.afterAll(async () => {
  await deleteActors([actor])
})

function urlFor(source: string): string {
  return source.includes('[id]') ? `/chat/${conversationId}` : ''
}

/** The routes a signed-in person actually navigates between, plus the landing page. */
const RESPONSIVE_ROUTES = AUDIT_ROUTES.filter((route) => route.dynamic !== 'share')

async function overflowOf(page: Page): Promise<{ scrollWidth: number; clientWidth: number }> {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
}

/**
 * How visible an element actually is, accounting for every ancestor.
 *
 * **Two weaker checks were tried first and both were measured to be incapable of
 * failing**, which is the only reason this exists:
 *
 * - `toBeVisible()` ignores opacity entirely. Playwright checks display,
 *   visibility and a non-empty box, so a fully transparent control is "visible".
 * - `toHaveCSS('opacity', '1')` on the control is no better here, because the
 *   `opacity-0` lives on the WRAPPER. The button's own opacity is 1 whether or
 *   not the reveal rule exists.
 *
 * Removing `pointer-coarse:opacity-100` from `UserMessage` left both green.
 * Multiplying up the ancestor chain is what turns that mutation red.
 */
async function effectiveOpacity(locator: Locator): Promise<number> {
  return locator.evaluate((element) => {
    let opacity = 1
    let node: Element | null = element

    while (node) {
      opacity *= Number(getComputedStyle(node).opacity)
      node = node.parentElement
    }

    return opacity
  })
}

for (const width of WIDTHS) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } })

    for (const route of RESPONSIVE_ROUTES) {
      test(`${route.url} does not scroll sideways`, async ({ page, context }) => {
        if (route.signedIn) await context.addCookies(actor.cookies)

        await page.goto(urlFor(route.source) || route.url)
        await page.waitForLoadState('networkidle')

        const { scrollWidth, clientWidth } = await overflowOf(page)

        // A pixel of slack for sub-pixel rounding; anything more is a real
        // horizontal scrollbar, which on a phone is the difference between a
        // usable page and one that slides under the reader's thumb.
        expect(scrollWidth, `${route.url} overflows at ${width}px`).toBeLessThanOrEqual(
          clientWidth + 1,
        )
      })
    }
  })
}

test.describe('with a coarse pointer at desktop width', () => {
  // An iPad in landscape: the desktop layout, and no hover to reveal anything.
  test.use({ hasTouch: true, viewport: { width: 1024, height: 768 } })

  test('reports no hover, so hover-only affordances would be unreachable', async ({
    page,
    context,
  }) => {
    await context.addCookies(actor.cookies)
    await page.goto('/chat')

    // The premise the rest of this block depends on. Without it the assertions
    // below would pass on a device that has hover after all, proving nothing.
    expect(
      await page.evaluate(() => ({
        coarse: matchMedia('(pointer: coarse)').matches,
        hover: matchMedia('(hover: hover)').matches,
      })),
    ).toEqual({ coarse: true, hover: false })
  })

  test('shows the message actions that a mouse would have to hover for', async ({
    page,
    context,
  }) => {
    await context.addCookies(actor.cookies)
    await page.goto(`/chat/${conversationId}`)

    // Edit lives behind `group-hover:opacity-100` with a `pointer-coarse:`
    // counterpart. Without that pair the whole edit feature is unreachable on a
    // touch device — present in the DOM, invisible on screen.
    //
    // **Asserted on computed opacity, not `toBeVisible()`.** Playwright treats
    // an `opacity: 0` element as visible — it checks display, visibility and a
    // non-empty box, and opacity is none of those — so `toBeVisible()` here
    // would pass whether or not the `pointer-coarse:` rule existed at all. That
    // is the test-that-cannot-fail shape, and it is the whole subject of this
    // block.
    expect(
      await effectiveOpacity(page.getByRole('button', { name: 'Edit' }).first()),
    ).toBe(1)
  })

  test('shows the sidebar row controls that a mouse would have to hover for', async ({
    page,
    context,
  }) => {
    await context.addCookies(actor.cookies)
    await page.goto('/chat')

    // ConversationRow is the one carrying `pointer-fine:opacity-0` rather than
    // relying on `pointer-coarse:` to reveal something a hover rule hid —
    // constraints.md records why: Tailwind emits `group-focus-within:opacity-0`
    // after `pointer-coarse:opacity-100` and both are single-class specificity,
    // so the hiding rule wins. Default to visible; let only a fine pointer hide.
    //
    // Computed opacity again, for the reason the test above records.
    expect(
      await effectiveOpacity(page.getByRole('button', { name: /^Options for/ }).first()),
    ).toBe(1)
  })
})
