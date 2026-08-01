import { PROVIDER_LABELS, SHARED_KEY_DAILY_MESSAGE_LIMIT } from '@/lib/constants'

import { listProviderKeys } from '@/server/data/provider-keys'

import { KeyRow } from '@/components/settings/KeyRow'

import type { Provider } from '@/types/domain'

/**
 * The keys page.
 *
 * A Server Component, so the stored keys never travel to the browser as
 * anything but the four display columns `listProviderKeys()` selects. Each row's
 * interactive half is a small client leaf beneath it.
 *
 * Every provider is listed whether configured or not, so the page answers "what
 * can I use" rather than only "what have I set up".
 */

const PROVIDERS = Object.keys(PROVIDER_LABELS) as Provider[]

/** Fixed to UTC so the server and the client cannot disagree about the day. */
const ADDED_ON = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})

export default async function KeysPage() {
  const keys = await listProviderKeys()

  const byProvider = new Map(keys.map((key) => [key.provider, key]))

  return (
    <section>
      <h2 className="sr-only">API keys</h2>

      <p className="text-body-md text-body">
        Add a provider key to use that provider&apos;s models. Keys are encrypted
        before they are stored, and only the last four characters are ever shown
        back to you.
      </p>

      <p className="mt-sm text-body-sm text-mute">
        Without a key of your own you get {SHARED_KEY_DAILY_MESSAGE_LIMIT} shared
        messages a day on Gemini Flash.
      </p>

      <div className="mt-xl">
        {PROVIDERS.map((provider) => {
          const stored = byProvider.get(provider)

          return (
            <KeyRow
              key={provider}
              provider={provider}
              label={PROVIDER_LABELS[provider]}
              lastFour={stored?.last_four ?? null}
              keyLabel={stored?.label ?? null}
              // Formatted here rather than in the client leaf, so the markup
              // does not depend on the browser's clock or locale and cannot
              // mismatch between the server render and hydration.
              addedOn={stored ? ADDED_ON.format(new Date(stored.created_at)) : null}
            />
          )
        })}
      </div>
    </section>
  )
}
