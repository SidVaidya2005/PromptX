import { SHARED_KEY_DAILY_MESSAGE_LIMIT } from '@/lib/constants'
import { defaultComparison } from '@/lib/compare'

import { listProviderKeys } from '@/server/data/provider-keys'
import { getTodaysUsage } from '@/server/data/shared-key-usage'
import { isSharedKeyAvailable } from '@/server/quota'

import { Compare } from '@/components/compare/Compare'

/**
 * One prompt against two models, side by side. (F31)
 *
 * The same three reads `/chat` opens with, and for the same reasons: which
 * providers this user holds a key for decides what the pickers offer, and the
 * two shared-key facts decide whether the allowance is in play at all. Run
 * concurrently, so the breaker check costs load rather than latency.
 *
 * **No conversation is created by visiting or by running.** This page has no
 * `[id]` to navigate to and leaves nothing behind — the route it posts to
 * imports no data module, which is the structural version of the promise.
 */
export default async function ComparePage() {
  const [keys, used, sharedKeyAvailable] = await Promise.all([
    listProviderKeys(),
    getTodaysUsage(),
    isSharedKeyAvailable(),
  ])

  const configuredProviders = keys.map((key) => key.provider)

  // Chosen on the server so the first paint is already correct — the right
  // column depends on which keys exist, and deciding it after hydration would
  // show the shared model on both for a frame.
  const { left, right } = defaultComparison(configuredProviders)

  return (
    <Compare
      configuredProviders={configuredProviders}
      remaining={Math.max(SHARED_KEY_DAILY_MESSAGE_LIMIT - used, 0)}
      sharedKeyAvailable={sharedKeyAvailable}
      defaultLeft={left}
      defaultRight={right}
    />
  )
}
