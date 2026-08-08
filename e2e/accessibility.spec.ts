import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

import { AUDIT_ROUTES, pageFilesOnDisk, type AuditRoute } from './support/routes'
import {
  adminClient,
  createActor,
  deleteActors,
  retryOnClockSkew,
  type Actor,
} from './support/session'

/**
 * The audit spec, and the fifth in a suite `code-standards.md` limits to four
 * flows. The exemption is written down there rather than assumed here: the four
 * flow specs exist so E2E does not grow to cover what a unit test can prove, and
 * axe proves something no unit test in this project can reach, because
 * `vitest.config.ts` runs a node environment over `tests/**` and can see nothing
 * rendered.
 *
 * **Serious and critical findings fail the build; moderate and minor are
 * reported.** That split is §37's own wording. Printing the rest rather than
 * silently discarding them is what keeps "no violations outstanding" an honest
 * sentence — the ones that remain are on the record instead of filtered out of
 * existence.
 *
 * The route list is checked against the filesystem, so a page added later cannot
 * quietly fall outside the sweep while the audit stays green.
 */

const SERIOUS = new Set(['serious', 'critical'])

let actor: Actor
let conversationId: string
let shareSlug: string

test.beforeAll(async () => {
  await retryOnClockSkew(async () => {
    actor = await createActor('a11y')
    const admin = adminClient()

    shareSlug = `a11y${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`

    const { data: conversation, error } = await admin
      .from('conversations')
      .insert({
        user_id: actor.id,
        title: 'Accessibility fixture',
        provider: 'google',
        model_id: 'gemini-3.6-flash',
        share_slug: shareSlug,
        shared_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    if (error) throw error
    conversationId = conversation.id

    // One exchange, so the thread renders a user message, an assistant message and
    // the controls that hang off them rather than an empty state.
    for (const [role, content] of [
      ['user', 'What does the reaper delete first?'],
      ['assistant', 'Objects first, then the rows.'],
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

function urlFor(route: AuditRoute): string {
  if (route.dynamic === 'conversation') return `/chat/${conversationId}`
  if (route.dynamic === 'share') return `/share/${shareSlug}`
  return route.url
}

async function visit(page: Page, route: AuditRoute): Promise<void> {
  if (route.signedIn) await page.context().addCookies(actor.cookies)
  await page.goto(urlFor(route))
  await page.waitForLoadState('networkidle')
}

test('the audit covers every page in the application', () => {
  // The guard that keeps the sweep honest as the app grows.
  const declared = AUDIT_ROUTES.map((route) => route.source).sort()

  expect(pageFilesOnDisk()).toEqual(declared)
})

for (const route of AUDIT_ROUTES) {
  test(`${route.url} has no serious or critical accessibility violations`, async ({
    page,
  }) => {
    await visit(page, route)

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()

    const blocking = results.violations.filter((violation) =>
      SERIOUS.has(violation.impact ?? ''),
    )

    const advisory = results.violations.filter(
      (violation) => !SERIOUS.has(violation.impact ?? ''),
    )

    if (advisory.length > 0) {
      // Reported, never dropped: "no serious or critical violations outstanding"
      // is only an honest claim if the rest are visible somewhere.
      console.log(
        `[a11y] ${route.url} — ${advisory.length} advisory finding(s): ` +
          advisory.map((v) => `${v.id} (${v.impact}) ×${v.nodes.length}`).join(', '),
      )
    }

    expect(
      blocking.map((violation) => ({
        rule: violation.id,
        impact: violation.impact,
        help: violation.help,
        nodes: violation.nodes.map((node) => node.html.slice(0, 120)),
      })),
    ).toEqual([])
  })
}
