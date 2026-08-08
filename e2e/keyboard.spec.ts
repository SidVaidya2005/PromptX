import { expect, test, type Page } from '@playwright/test'

import {
  adminClient,
  createActor,
  deleteActors,
  retryOnClockSkew,
  type Actor,
} from './support/session'

/**
 * Keyboard reachability, the focus ring, and what a dialog does with focus. (F37)
 *
 * Part of the audit suite. Axe checks a great deal but it cannot press Tab — it
 * reads a static tree, so a control that is focusable but invisible when
 * focused, or a dialog that drops focus onto `<body>` when it closes, passes
 * every rule it has.
 *
 * The focus ring is asserted from **computed style on the focused element**
 * rather than from the stylesheet, because `:focus-visible` only resolves
 * against real keyboard interaction — a rule that exists in CSS and never
 * matches would satisfy any assertion made against the source.
 */

let actor: Actor

test.beforeAll(async () => {
  await retryOnClockSkew(async () => {
    actor = await createActor('keyboard')

    // A conversation so the sidebar has a row with an overflow menu — the
    // destructive-confirmation test needs one to open.
    const { error } = await adminClient().from('conversations').insert({
      user_id: actor.id,
      title: 'Keyboard fixture',
      provider: 'google',
      model_id: 'gemini-3.6-flash',
    })

    if (error) throw error
  })
})

test.afterAll(async () => {
  await deleteActors([actor])
})

/** The focused element's ring, as the browser actually computes it. */
async function focusedRing(page: Page) {
  return page.evaluate(() => {
    const element = document.activeElement
    if (!element || element === document.body) return null

    const style = getComputedStyle(element)

    return {
      tag: element.tagName,
      name:
        element.getAttribute('aria-label') ??
        element.textContent?.trim().slice(0, 40) ??
        '',
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      // A ring can legitimately be a box-shadow rather than an outline, so both
      // count. Checked against the FOCUSED element's computed style, because
      // `:focus-visible` resolves only under real keyboard interaction — a rule
      // that exists in the stylesheet and never matches would satisfy any
      // assertion made against the source.
      boxShadow: style.boxShadow,
    }
  })
}

/**
 * The one control whose focus indicator is not its own.
 *
 * The composer textarea carries `outline-none` on purpose and its focus state is
 * shown by the surrounding box brightening its border (`focus-within:border-mute`)
 * — a ring drawn inside a bordered container reads as a second border. That is
 * permitted by `code-standards.md`, which forbids `outline: none` *without a
 * replacement*, and the replacement is asserted on its own below rather than
 * waved through here.
 */
const RING_ON_CONTAINER = ['TEXTAREA:Message']

const ROUTES = ['/', '/chat', '/prompts', '/search', '/settings/keys'] as const

for (const route of ROUTES) {
  test(`every control reached by Tab on ${route} shows a focus ring`, async ({
    page,
    context,
  }) => {
    if (route !== '/') await context.addCookies(actor.cookies)
    await page.goto(route)
    await page.waitForLoadState('networkidle')

    const seen: string[] = []
    const ringless: string[] = []

    // Twenty-five stops is past the end of every route here; the loop breaks
    // when focus wraps back to where it started.
    for (let step = 0; step < 25; step += 1) {
      await page.keyboard.press('Tab')
      const ring = await focusedRing(page)
      if (!ring) continue

      const id = `${ring.tag}:${ring.name}`
      if (seen.includes(id) && seen[0] === id) break
      seen.push(id)

      const hasOutline = ring.outlineStyle !== 'none' && ring.outlineWidth !== '0px'
      const hasShadowRing = ring.boxShadow !== 'none'

      if (!hasOutline && !hasShadowRing && !RING_ON_CONTAINER.includes(id)) {
        ringless.push(id)
      }
    }

    expect(seen.length, `nothing was focusable on ${route}`).toBeGreaterThan(0)
    expect(ringless, `controls focusable without a visible ring on ${route}`).toEqual([])
  })
}

test('the composer shows focus on its container, since the field itself has no ring', async ({
  page,
  context,
}) => {
  // The replacement `code-standards.md` requires for an `outline: none`. Without
  // this assertion the allowlist above would be a hole rather than an exception:
  // the textarea would be exempt from the ring check and nothing would confirm
  // it shows focus at all.
  await context.addCookies(actor.cookies)
  await page.goto('/chat')

  const field = page.getByRole('textbox', { name: 'Message' })

  // Walks up to the nearest ancestor that actually draws a border, rather than
  // matching on a class name — `code-standards.md` forbids selecting by class
  // here, and the classes are design tokens that are expected to change.
  const borderColour = () =>
    field.evaluate((element) => {
      let node: HTMLElement | null = element.parentElement

      while (node && getComputedStyle(node).borderTopWidth === '0px') {
        node = node.parentElement
      }

      return node ? getComputedStyle(node).borderColor : null
    })

  const resting = await borderColour()
  expect(resting).not.toBeNull()

  await field.focus()

  // Polled rather than read once. The container carries `transition-colors`, so
  // a read in the same tick as the focus returns the START of a 150ms
  // transition — the trap constraints.md records from F07, where two "bugs"
  // turned out to be premature reads.
  await expect.poll(borderColour, { timeout: 2_000 }).not.toBe(resting)
})

test('a dialog traps focus and hands it back on Escape', async ({ page, context }) => {
  await context.addCookies(actor.cookies)
  await page.goto('/settings/keys')

  const trigger = page.getByRole('button', { name: 'Add' }).first()
  await trigger.click()
  await expect(page.getByRole('heading', { name: 'Add your OpenAI key' })).toBeVisible()

  // Trapped: tabbing repeatedly never escapes the dialog. Ten stops is more
  // than the dialog contains, so without a trap focus would have left it.
  for (let step = 0; step < 10; step += 1) {
    await page.keyboard.press('Tab')
    const insideDialog = await page.evaluate(
      () => document.activeElement?.closest('[role="dialog"]') !== null,
    )
    expect(insideDialog, `focus left the dialog after ${step + 1} tabs`).toBe(true)
  }

  await page.keyboard.press('Escape')
  await expect(page.getByRole('heading', { name: 'Add your OpenAI key' })).toBeHidden()

  // Restored to the trigger, not dropped on <body>. A keyboard user who changes
  // their mind otherwise has nothing to tab from and starts the page again —
  // the failure constraints.md records from F25's insert-a-prompt work.
  await expect(trigger).toBeFocused()
})

test('a destructive confirmation focuses Cancel rather than the destructive action', async ({
  page,
  context,
}) => {
  await context.addCookies(actor.cookies)
  await page.goto('/chat')
  await page.waitForLoadState('networkidle')

  // Two things are needed to reach this menu, and neither is a defect.
  //
  // `visible=true` because the sidebar is in the document twice below 1024px —
  // the desktop aside and the drawer copy — and `.first()` can otherwise
  // resolve to the hidden one. constraints.md records the same disambiguation
  // from F11.
  //
  // And the row is hovered first, because the trigger rests at `opacity: 0` on
  // a fine pointer and the row link's full-bleed `after:inset-0` overlay wins
  // the hit test until the hover reveals it. Checked before assuming a bug: on
  // hover the trigger computes to `opacity: 1`, `z-index: 10`, and the click
  // lands. That is the interaction a mouse user actually performs.
  const row = page.getByRole('listitem').filter({ hasText: 'Keyboard fixture' }).first()
  await row.hover()

  await page
    .getByRole('button', { name: /^Options for/ })
    .locator('visible=true')
    .first()
    .click()

  await page.getByRole('menuitem', { name: 'Delete' }).click()

  // An AlertDialog rather than a Dialog, and this is the difference that
  // matters: it focuses the safe choice, so Enter on a dialog that appeared
  // unexpectedly does not destroy a conversation.
  await expect(page.getByRole('alertdialog')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeFocused()
})
