import { describe, expect, it } from 'vitest'

import { defaultComparison, refusalMessage } from '@/lib/compare'
import { SHARED_MODEL_ID } from '@/lib/constants'
import { isModelAvailable } from '@/lib/models'

/**
 * The two pure rules behind the compare view. (F31)
 *
 * Both are here rather than inside the components precisely so they can be
 * tested at all — `vitest.config.ts` matches `tests/**` in a node environment,
 * so a decision living in a Client Component is a decision nothing in this suite
 * can reach.
 */

describe('defaultComparison', () => {
  it('opens the left column on the model everyone can reach', () => {
    // The same default /chat takes, for the same reason: it is the only choice
    // guaranteed to work for someone who has added no key.
    expect(defaultComparison([]).left).toEqual({
      provider: 'google',
      modelId: SHARED_MODEL_ID,
    })
  })

  it('opens the right column on something else, so the default is a comparison', () => {
    const { left, right } = defaultComparison(['openrouter'])

    expect(right).not.toEqual(left)
  })

  it('only ever pre-selects a model the caller can actually send to', () => {
    // The picker greys out what `isModelAvailable` refuses and `resolveModel()`
    // rejects it on the server, so defaulting to one would put a disabled row in
    // the picker and then refuse the first click.
    for (const configured of [[], ['openrouter'], ['google', 'openrouter']] as const) {
      const { left, right } = defaultComparison(configured)

      expect(isModelAvailable(left.provider, left.modelId, configured)).toBe(true)
      expect(isModelAvailable(right.provider, right.modelId, configured)).toBe(true)
    }
  })

  it('falls back to the same model when the caller can reach only one', () => {
    // A keyless user has exactly the shared model available. Honest and useless
    // beats a second column pointing at something the first send would refuse.
    const { left, right } = defaultComparison([])

    expect(right).toEqual(left)
  })
})

describe('refusalMessage', () => {
  it('says nothing when nothing failed', () => {
    expect(refusalMessage(undefined)).toBeNull()
  })

  it('unwraps the sentence out of the route’s own body', () => {
    // The AI SDK's transport does `throw new Error(await response.text())` on a
    // non-ok response — read off the installed package, not assumed — so the
    // message arriving here is the JSON /api/compare returned. Rendering it
    // untouched would put a JSON object on screen where a sentence belongs.
    const error = new Error(
      JSON.stringify({
        error: "You've used your 20 free messages for today",
        code: 'quota_exceeded',
      }),
    )

    expect(refusalMessage(error)).toBe("You've used your 20 free messages for today")
  })

  it('falls back for anything that is not one of ours', () => {
    // A network failure, a proxy's HTML error page, a bug in the route. None of
    // them is a string worth showing verbatim.
    expect(refusalMessage(new Error('Failed to fetch'))).toBe(
      'Something went wrong. Try that again.',
    )
    expect(refusalMessage(new Error('<html>502 Bad Gateway</html>'))).toBe(
      'Something went wrong. Try that again.',
    )
  })

  it('falls back for JSON that parses but says nothing', () => {
    // `JSON.parse('"quota_exceeded"')` and `JSON.parse('null')` both succeed, so
    // parsing is not on its own evidence that there is a sentence in there.
    expect(refusalMessage(new Error('null'))).toBe('Something went wrong. Try that again.')
    expect(refusalMessage(new Error('"quota_exceeded"'))).toBe(
      'Something went wrong. Try that again.',
    )
    expect(refusalMessage(new Error('{"error":""}'))).toBe(
      'Something went wrong. Try that again.',
    )
  })
})
