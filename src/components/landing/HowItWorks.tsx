import { SHARED_KEY_DAILY_MESSAGE_LIMIT } from '@/lib/constants'

const STEPS = [
  {
    number: '01',
    title: 'Sign in with Google',
    body: 'The only sign-in method. No password to choose, forget, or leak.',
  },
  {
    number: '02',
    title: 'Start talking',
    body: `The shared Gemini key answers straight away — ${SHARED_KEY_DAILY_MESSAGE_LIMIT} messages a day, no setup, no card.`,
  },
  {
    number: '03',
    title: 'Add your own key',
    body: 'Paste an OpenAI, Anthropic, Google, or OpenRouter key in settings. The model picker opens up and the daily cap stops applying.',
  },
] as const

/** The three steps between landing here and a working workspace. */
export function HowItWorks() {
  return (
    <section className="border-t border-hairline">
      <div className="mx-auto flex max-w-300 flex-col gap-xl px-xl py-3xl tablet:py-5xl">
        <h2 className="text-display-sm text-ink">Thirty seconds to a first answer</h2>

        <ol className="grid gap-xl tablet:grid-cols-3">
          {STEPS.map((step) => (
            <li key={step.number} className="flex flex-col gap-xs">
              <span className="font-mono text-code-md text-mute">{step.number}</span>
              <h3 className="text-body-md-strong text-ink">{step.title}</h3>
              <p className="text-body-sm text-body">{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
