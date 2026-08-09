import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * Nothing on the shared-key path retries. (F38)
 *
 * The arithmetic, because a rule without its reason gets tidied away: the AI SDK
 * defaults to 2 retries and fires its three attempts at roughly 0s, 2s and 6s.
 * Google answers an exhausted free-tier quota with a retry-after measured in
 * tens of seconds — 52s when this was found — so every retry lands inside the
 * window and cannot succeed. One refused request becomes three, which is 15% of
 * a 20-request day spent proving a refusal we were already told about, and the
 * retries keep the bucket empty so the outage outlives the burst that caused it.
 *
 * This is a source assertion rather than a behavioural one, and the tradeoff is
 * deliberate. `/api/chat` reaches auth, the quota reservation, the vault and the
 * provider registry, so calling it in a unit test means standing all four up to
 * observe one argument. `tests/security/key-exposure.test.ts` already
 * establishes that a static scan is the right shape when what you are guarding
 * against is a future edit rather than today's behaviour — the same reasoning
 * applies here, with the same known bluntness: this cannot tell a comment from
 * a call, so comments bend around it rather than the other way round.
 *
 * What it would miss: someone setting `maxRetries` from a variable that happens
 * to be non-zero. What it catches, which is the realistic regression: someone
 * deleting the line, or "simplifying" the conditional to apply everywhere.
 */

const CHAT_ROUTE = fileURLToPath(
  new URL('../../src/app/api/chat/route.ts', import.meta.url),
)
const TITLES = fileURLToPath(
  new URL('../../src/server/titles.ts', import.meta.url),
)

/** Strips block and line comments so a mention cannot satisfy an assertion. */
function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('shared-key requests do not retry', () => {
  it('the chat route sets maxRetries to 0 when the shared key is used', () => {
    expect(code(CHAT_ROUTE)).toMatch(
      /maxRetries:\s*usedSharedKey\s*\?\s*0\s*:/,
    )
  })

  it('the chat route still lets a caller with their own key retry', () => {
    // The conditional is the whole point. A blanket `maxRetries: 0` would take
    // retries away from BYOK requests, which have their own limits and their own
    // billing, and where a transient network fault is exactly what retries are
    // for. Pinned so that "simplifying" the ternary fails here.
    const source = code(CHAT_ROUTE)

    expect(source).not.toMatch(/maxRetries:\s*0\s*,/)
    expect(source).toMatch(/maxRetries:\s*usedSharedKey\s*\?\s*0\s*:\s*undefined/)
  })

  it('title generation sets maxRetries to 0 unconditionally', () => {
    // Unconditional here and conditional in the route, because sharedTitleModel()
    // takes no user id — there is nobody to charge, so this call is always on the
    // shared key. A title is also cosmetic, which makes spending two more of the
    // day's twenty requests on it the worst trade available at the moment the
    // quota is already refusing real answers.
    expect(code(TITLES)).toMatch(/maxRetries:\s*0\s*,/)
  })
})
