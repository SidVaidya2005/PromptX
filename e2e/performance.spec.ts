import { expect, test } from '@playwright/test'

import {
  adminClient,
  createActor,
  deleteActors,
  retryOnClockSkew,
  type Actor,
} from './support/session'

/**
 * The performance budget, measured rather than scored. (F37)
 *
 * §37 names Lighthouse ≥ 90, and F38 already re-runs Lighthouse against
 * production on a warm instance — which is the only place that composite number
 * means anything, since a local run flatters both the network and the region.
 * What is worth pinning *here* is the sub-metrics the budget actually
 * constrains, taken from `PerformanceObserver` against the same production build
 * the flow specs use.
 *
 * **The 200-message conversation is the point of this file.** It is the page
 * §37 predicts is most likely to breach, and `listByConversation()` has had no
 * `.limit()` since Phase 1, with `MESSAGE_PAGE_SIZE` sitting unreferenced in
 * `constants.ts` for seven phases. The Phase 1 open item asked for exactly this:
 * measure, then either paginate or accept it with a number attached. The numbers
 * are asserted so the decision cannot quietly rot — if a later change makes this
 * page slow, this is what says so.
 *
 * INP is deliberately absent. It needs a real interaction and settles over a
 * session, so a single scripted click produces a number that looks authoritative
 * and is not. Long-task duration during the scroll is measured instead, which is
 * the thing that makes a long thread feel bad.
 */

const MESSAGE_COUNT = 200

let actor: Actor
let conversationId: string

test.beforeAll(async () => {
  // Seeding 200 rows against a hosted project in Singapore outruns the default
  // hook timeout. Playwright takes this from `setTimeout` inside the hook —
  // unlike Vitest, it has no second timeout argument on `beforeAll`.
  test.setTimeout(120_000)

  await retryOnClockSkew(async () => {
    actor = await createActor('perf')
    const admin = adminClient()

    const { data, error } = await admin
      .from('conversations')
      .insert({
        user_id: actor.id,
        title: 'Two hundred messages',
        provider: 'google',
        model_id: 'gemini-3.6-flash',
      })
      .select('id')
      .single()

    if (error) throw error
    conversationId = data.id

    // Inserted in one statement: 200 round trips to Singapore would dominate
    // the suite, and nothing here depends on the rows having distinct
    // timestamps — the thread order is `(created_at, id)` and the ids break any
    // tie deterministically.
    const rows = Array.from({ length: MESSAGE_COUNT }, (_, index) => ({
      conversation_id: conversationId,
      user_id: actor.id,
      role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content:
        index % 2 === 0
          ? `Question number ${index / 2 + 1}: what happens next?`
          : `Answer number ${(index + 1) / 2}. ` + 'Some prose to give it height. '.repeat(6),
      provider: index % 2 === 0 ? null : ('google' as const),
      model_id: index % 2 === 0 ? null : 'gemini-3.6-flash',
    }))

    const { error: seedError } = await admin.from('messages').insert(rows)
    if (seedError) throw seedError
  })
})

test.afterAll(async () => {
  await deleteActors([actor])
})

test('a 200-message conversation loads within the budget', async ({ page, context }) => {
  await context.addCookies(actor.cookies)

  await page.goto(`/chat/${conversationId}`)
  await page.waitForLoadState('networkidle')

  const vitals = await page.evaluate(async () => {
    // LCP and CLS are reported through PerformanceObserver with buffered
    // entries, so entries emitted before this ran are still delivered.
    const lcp = await new Promise<number>((resolve) => {
      let latest = 0
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) latest = entry.startTime
      }).observe({ type: 'largest-contentful-paint', buffered: true })
      setTimeout(() => resolve(latest), 500)
    })

    const cls = await new Promise<number>((resolve) => {
      let total = 0
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const shift = entry as PerformanceEntry & {
            value: number
            hadRecentInput: boolean
          }
          if (!shift.hadRecentInput) total += shift.value
        }
      }).observe({ type: 'layout-shift', buffered: true })
      setTimeout(() => resolve(total), 500)
    })

    return { lcp, cls }
  })

  const rendered = await page.getByRole('main').evaluate((node) => node.textContent?.length ?? 0)

  // The thread really is all there — a budget met by rendering nothing would be
  // no result at all.
  expect(rendered, 'the whole thread should be rendered').toBeGreaterThan(5_000)

  expect(vitals.lcp, `LCP ${Math.round(vitals.lcp)}ms`).toBeLessThanOrEqual(2_500)
  expect(vitals.cls, `CLS ${vitals.cls.toFixed(3)}`).toBeLessThanOrEqual(0.1)

  console.log(
    `[perf] ${MESSAGE_COUNT} messages — LCP ${Math.round(vitals.lcp)}ms, ` +
      `CLS ${vitals.cls.toFixed(3)}, ${rendered} characters rendered`,
  )
})

test('scrolling a 200-message conversation blocks the main thread only briefly', async ({
  page,
  context,
}) => {
  await context.addCookies(actor.cookies)
  await page.goto(`/chat/${conversationId}`)
  await page.waitForLoadState('networkidle')

  const result = await page.evaluate(async () => {
    const tasks: number[] = []
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) tasks.push(entry.duration)
    }).observe({ type: 'longtask', buffered: true })

    // The scroller is found by behaviour — the tallest scrollable element —
    // rather than by class name, which code-standards.md forbids selecting on.
    const scroller = [...document.querySelectorAll('*')]
      .filter((node) => node.scrollHeight > node.clientHeight + 200)
      .sort((a, b) => b.scrollHeight - a.scrollHeight)[0]

    if (!scroller) return { longest: 0, scrolled: 0 }

    for (let step = 0; step < 20; step += 1) {
      scroller.scrollTop = (scroller.scrollHeight / 20) * step
      await new Promise((resolve) => requestAnimationFrame(resolve))
    }

    await new Promise((resolve) => setTimeout(resolve, 300))

    return {
      longest: tasks.length > 0 ? Math.max(...tasks) : 0,
      scrolled: scroller.scrollTop,
    }
  })

  // Without this the measurement is worthless: a scroller that was never found
  // reports zero long tasks and the assertion passes having scrolled nothing.
  expect(result.scrolled, 'the thread should actually have scrolled').toBeGreaterThan(500)

  // A task over ~200ms is a visible stall. Reported either way, so the figure
  // behind "scrolls without jank" is on the record rather than asserted from a
  // feeling.
  console.log(
    `[perf] longest main-thread task while scrolling: ${Math.round(result.longest)}ms ` +
      `(scrolled ${Math.round(result.scrolled)}px)`,
  )
  expect(result.longest, `longest task ${Math.round(result.longest)}ms`).toBeLessThan(200)
})

test('the landing page stays light, because it is what a cold instance serves first', async ({
  page,
}) => {
  // Render's free tier sleeps after 15 minutes and takes about a minute to wake,
  // so `/` is the first thing a waking process serves to the visitor this whole
  // project exists to impress. architecture.md makes that a design constraint:
  // no client-side fetch, nothing that defers meaningful paint.
  await page.goto('/')
  await page.waitForLoadState('networkidle')

  // Read from the resource timeline rather than from `content-length` headers.
  // The first attempt used headers and measured 0.0 KB — `next start` serves
  // these chunked and gzipped, so the header is frequently absent and the
  // assertion passed having summed nothing at all. `encodedBodySize` is the
  // compressed bytes the browser actually received.
  const scripts = await page.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .filter((entry) => entry.name.includes('/_next/static/') && entry.name.endsWith('.js'))
      .map((entry) => (entry as PerformanceResourceTiming).encodedBodySize),
  )

  const total = scripts.reduce((sum, size) => sum + size, 0)

  expect(scripts.length, 'no scripts were measured').toBeGreaterThan(0)
  expect(total, 'the measured JS total should not be zero').toBeGreaterThan(0)

  console.log(
    `[perf] landing page JS: ${(total / 1024).toFixed(1)} KB over the wire ` +
      `across ${scripts.length} files`,
  )

  // The budget is 200KB gzipped; `next start` serves gzip, so content-length is
  // the compressed figure.
  expect(total / 1024, `${(total / 1024).toFixed(1)} KB`).toBeLessThanOrEqual(200)
})
