import { SHARED_KEY_DAILY_MESSAGE_LIMIT } from '@/lib/constants'

import { GoogleSignInButton } from '@/components/auth/GoogleSignInButton'

/**
 * The signed-out hero, and the only place in the product where Instrument Serif
 * appears — one italic phrase inside the headline, per DESIGN.md.
 *
 * Everything here is server-rendered except the button. This page is what a
 * waking free-tier instance serves first, so it carries no client-side fetch
 * and nothing that defers meaningful paint.
 */
export function LandingHero() {
  return (
    <section className="mx-auto flex max-w-300 flex-col gap-xl px-xl py-3xl tablet:py-5xl">
      <h1 className="max-w-200 text-display-md text-ink tablet:text-display-lg desktop:text-display-xl">
        One workspace for{' '}
        <span className="font-serif text-display-serif">every model</span>
      </h1>

      <p className="max-w-160 text-body-lg text-body">
        Chat with OpenAI, Anthropic, Google, and OpenRouter in one thread, using the
        API keys you already pay for. They are encrypted before they are stored and
        never leave the server.
      </p>

      <div className="flex flex-col gap-sm">
        <GoogleSignInButton />
        <p className="text-caption text-mute">
          No key yet? Start on the shared Gemini key —{' '}
          {SHARED_KEY_DAILY_MESSAGE_LIMIT} messages a day, free, nothing to set up.
        </p>
      </div>
    </section>
  )
}
