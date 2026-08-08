/**
 * The two pure rules the compare view needs. (F31)
 *
 * Here rather than in the components because both are decisions rather than
 * markup, and `vitest.config.ts` matches `tests/**` in a node environment — a
 * rule living inside a Client Component is a rule no test in this project can
 * reach.
 */

import { SHARED_MODEL_ID } from '@/lib/constants'
import { isModelAvailable, MODEL_CATALOG, PROVIDER_ORDER } from '@/lib/models'

import type { Provider } from '@/types/domain'

export type ModelChoice = { provider: Provider; modelId: string }

/**
 * Which two models a comparison opens on.
 *
 * The left is the shared model, for the reason `/chat` defaults to it: it is the
 * one choice guaranteed to work for someone who has added no key.
 *
 * **The right is the first available model that is not the left one**, walking
 * the catalog in `PROVIDER_ORDER`. Defaulting both to the shared model would
 * make the out-of-the-box action a comparison of one model against itself — two
 * of twenty daily messages spent to learn nothing — and the picker being one
 * click away is not a reason to open on a state nobody wants.
 *
 * It falls back to the left when there is genuinely nothing else: a user with no
 * keys can reach exactly one model, and pre-selecting an unavailable one would
 * put a disabled model in a picker that greys out precisely such choices, then
 * refuse the first send. Honest and useless beats dishonest.
 */
export function defaultComparison(configuredProviders: readonly Provider[]): {
  left: ModelChoice
  right: ModelChoice
} {
  const left: ModelChoice = { provider: 'google', modelId: SHARED_MODEL_ID }

  const right = PROVIDER_ORDER.flatMap((provider) =>
    MODEL_CATALOG[provider].map((model) => ({ provider, modelId: model.id })),
  ).find(
    (candidate) =>
      isModelAvailable(candidate.provider, candidate.modelId, configuredProviders) &&
      !(candidate.provider === left.provider && candidate.modelId === left.modelId),
  )

  return { left, right: right ?? left }
}

/**
 * What a column says when its request was refused.
 *
 * **The AI SDK puts the raw response body in `error.message`** — read off the
 * installed package rather than assumed: its transport does
 * `throw new Error(await response.text())` on any non-ok response. So an error
 * arriving here is the JSON this route already returns, and rendering it
 * untouched would show a reader `{"error":"You've used your 20 free messages for
 * today","code":"quota_exceeded"}`.
 *
 * Unwrapping it is the point of this function: every refusal `/api/compare` can
 * make already carries a sentence written for a person — a spent allowance, a
 * paused shared key, a provider with no key configured — and a column that
 * replaced all four with "something went wrong" would throw away the only thing
 * telling the user what to do next.
 *
 * Anything that is not that shape gets the generic sentence. A network failure,
 * a proxy's HTML error page and a bug in this route all reach here, and none of
 * them is a message worth showing verbatim.
 */
export function refusalMessage(error: Error | undefined): string | null {
  if (!error) return null

  try {
    const parsed: unknown = JSON.parse(error.message)

    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'error' in parsed &&
      typeof parsed.error === 'string' &&
      parsed.error !== ''
    ) {
      return parsed.error
    }
  } catch {
    // Not JSON, so not one of ours.
  }

  return 'Something went wrong. Try that again.'
}
