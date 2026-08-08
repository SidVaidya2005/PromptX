import { expect, test } from '@playwright/test'

import { adminClient, createActor, deleteActors, type Actor } from './support/session'

/**
 * Adding a provider key, and the one thing that must never happen afterwards.
 *
 * The invariant this whole application is organised around is that **no
 * decrypted API key ever leaves the server** — not in a response body, not in a
 * log, not in an error message; `last_four` is the only key material a client
 * may receive. `tests/security/key-exposure.test.ts` guards it two ways already:
 * it pins what `POST /api/keys` returns, and it greps the route tree so the rule
 * survives someone *adding* a route that reaches for a plaintext key.
 *
 * What neither of those can see is the screen. A key could be returned correctly
 * and still be rendered — in a value attribute, a title, a debug block, an error
 * toast echoing the request. This spec asserts against the served HTML of the
 * page after a successful add: the submitted key appears nowhere in it, and the
 * last four do.
 *
 * `POST /api/keys` is intercepted, so no provider is probed. That is not only
 * about money: `probeKey` fails closed on a `401`, so a fabricated key would be
 * refused and never stored, and the flow under test would never reach its own
 * success state. The interception is what lets the spec exercise the path a real
 * valid key takes.
 *
 * **The interception also has to perform the write, and finding that out is
 * worth recording.** The first version stubbed only the response, and the row
 * never appeared on screen: a successful mutation calls `router.refresh()`, which
 * re-renders the Server Component from the DATABASE rather than from whatever
 * the client just received. So a handler that answers `201` and stores nothing
 * produces a page that correctly reports "Not configured". The handler therefore
 * writes the row it is pretending to have written — the encryption itself is
 * covered by `tests/server/vault.ts` and `tests/server/provider-keys.test.ts`,
 * which is why a placeholder ciphertext is honest here rather than a shortcut.
 */

/** Obviously not a real key, and shaped like one so a leak would be recognisable. */
const SUBMITTED_KEY = 'sk-e2e-do-not-use-0000000000000000wxyz'
const LAST_FOUR = 'wxyz'

let actor: Actor

/**
 * Both tests store a key for the same user and the table is `unique (user_id,
 * provider)`, so they cannot run at the same time against one row. Serial rather
 * than a second fixture user: the collision is the point of the constraint, not
 * something to design around.
 */
test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  actor = await createActor('addkey')
})

/**
 * Each test starts from "no key stored".
 *
 * Without this the second test inherits the first one's row, the OpenAI line
 * reads "Replace" instead of "Add", and the failure is a locator timeout that
 * says nothing about the cause — which is exactly how it presented before the
 * suite was made serial. State a test depends on should be state it establishes.
 */
test.beforeEach(async () => {
  const { error } = await adminClient()
    .from('provider_keys')
    .delete()
    .eq('user_id', actor.id)

  if (error) throw error
})

/**
 * What the real route does after a successful probe, minus the encryption.
 *
 * Placeholder bytea rather than real ciphertext: nothing on this page decrypts
 * anything — `listProviderKeys()` selects provider, last_four, label and
 * created_at and never touches the sealed columns, which is itself asserted in
 * `tests/server/provider-keys.test.ts`.
 */
async function storeKeyAsTheRouteWould(): Promise<void> {
  const { error } = await adminClient()
    .from('provider_keys')
    .upsert(
      {
        user_id: actor.id,
        provider: 'openai',
        ciphertext: '\\xdeadbeef',
        iv: '\\xdeadbeefdeadbeefdeadbeef',
        auth_tag: '\\xdeadbeefdeadbeefdeadbeefdeadbeef',
        last_four: LAST_FOUR,
      },
      { onConflict: 'user_id,provider' },
    )

  if (error) throw error
}

test.afterAll(async () => {
  await deleteActors([actor])
})

test('stores a key and shows only its last four characters', async ({ page, context }) => {
  let hits = 0
  let submittedBody = ''

  await page.route('**/api/keys', async (route) => {
    hits += 1
    submittedBody = route.request().postData() ?? ''

    await storeKeyAsTheRouteWould()

    // Exactly the shape the real route returns, and nothing more: provider,
    // lastFour, label, createdAt. If the real response ever grew a field
    // carrying key material, this fixture would not — which is why the static
    // scan in tests/security/ exists alongside it.
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        provider: 'openai',
        lastFour: LAST_FOUR,
        label: null,
        createdAt: new Date().toISOString(),
      }),
    })
  })

  await context.addCookies(actor.cookies)
  await page.goto('/settings/keys')

  // The rows are plain containers with no accessible grouping, and
  // library-docs.md forbids selecting by CSS class — the class names here are
  // design tokens and are expected to change. So the row is reached by ordinal
  // and then CONFIRMED by the dialog's own title: if PROVIDER_LABELS is ever
  // reordered this fails by name rather than silently testing Anthropic.
  await page.getByRole('button', { name: 'Add' }).first().click()
  await expect(page.getByRole('heading', { name: 'Add your OpenAI key' })).toBeVisible()

  await page.getByLabel('API key').fill(SUBMITTED_KEY)
  await page.getByRole('button', { name: 'Save key' }).click()

  // The dialog closing is the client's own signal that the save succeeded.
  await expect(page.getByRole('heading', { name: 'Add your OpenAI key' })).toBeHidden()

  // Then reload before asserting what is displayed, rather than relying on the
  // in-page refresh. **Measured, and the reason is on the record:** under this
  // interception the row appeared after `router.refresh()` only about half the
  // time, while the write and the fulfilment succeeded every time (checked by
  // reading the table straight after). It is not a general fault in the refresh
  // path — the real, un-intercepted DELETE flow on this same page updated the
  // list 4 runs out of 4 — so what is left is an artefact of the row being
  // written by the test process rather than by the route. Recorded as a
  // follow-up rather than asserted as a product bug, because it has not been
  // reproduced against a real POST.
  await page.reload()
  await expect(page.getByText(`••••${LAST_FOUR}`)).toBeVisible()

  // The assertion the feature exists for, made against the whole served
  // document rather than one element — a leak would not announce which element
  // it chose. Same reasoning as F34's export test asserting on the serialised
  // payload: what it guards against is a place nobody thought to look.
  const html = await page.content()
  expect(html).not.toContain(SUBMITTED_KEY)
  expect(html).not.toContain('sk-e2e-do-not-use')
  expect(html).toContain(LAST_FOUR)

  // The key did leave the browser — that is the point of the form — so this
  // confirms the test submitted what it thinks it did, and that the absence
  // above is not simply a form that never sent anything.
  expect(submittedBody).toContain(SUBMITTED_KEY)
  expect(hits).toBe(1)
})

test('does not leave the key in the input after the dialog closes', async ({ page, context }) => {
  // A password input still holds its value in the DOM. Reopening the dialog to
  // a pre-filled key would put it back on screen — behind dots, but present in
  // the document and readable by anything that can query it.
  await page.route('**/api/keys', async (route) => {
    await storeKeyAsTheRouteWould()
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        provider: 'openai',
        lastFour: LAST_FOUR,
        label: null,
        createdAt: new Date().toISOString(),
      }),
    })
  })

  await context.addCookies(actor.cookies)
  await page.goto('/settings/keys')

  await page.getByRole('button', { name: 'Add' }).first().click()
  await expect(page.getByRole('heading', { name: 'Add your OpenAI key' })).toBeVisible()
  await page.getByLabel('API key').fill(SUBMITTED_KEY)
  await page.getByRole('button', { name: 'Save key' }).click()

  await expect(page.getByRole('heading', { name: 'Add your OpenAI key' })).toBeHidden()
  await page.reload()
  await expect(page.getByText(`••••${LAST_FOUR}`)).toBeVisible()

  await page.getByRole('button', { name: 'Replace' }).first().click()

  await expect(page.getByLabel('API key')).toHaveValue('')
  expect(await page.content()).not.toContain(SUBMITTED_KEY)
})
