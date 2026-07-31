/** Four claims the product actually keeps. No icons, no illustration system. */
const FEATURES = [
  {
    title: 'Your keys stay yours',
    body: 'Every API key is encrypted with AES-256-GCM before it is stored. The only part of a key the browser ever receives is its last four characters.',
  },
  {
    title: 'One history, searchable',
    body: 'Full-text search across every message you have ever sent, ranked, with the matching phrases highlighted. No more guessing which vendor you asked.',
  },
  {
    title: 'Switch models mid-thread',
    body: 'Change provider without losing the conversation. Every answer records the model that produced it, so a thread that changed models stays legible.',
  },
  {
    title: 'Compare two models',
    body: 'Send one prompt to two models and read the answers side by side. Keep the one you prefer and carry on with it in a real conversation.',
  },
] as const

export function FeatureGrid() {
  return (
    // No top padding: the hero's bottom band already provides the gap, and the
    // other seams on this page are marked by a hairline where this one is not.
    <section className="mx-auto max-w-300 px-xl pb-3xl tablet:pb-5xl">
      <div className="grid gap-lg tablet:grid-cols-2">
        {FEATURES.map((feature) => (
          // Elevation is surface contrast plus a hairline. Never a shadow.
          <article
            key={feature.title}
            className="flex flex-col gap-sm rounded-md border border-hairline bg-canvas-soft p-xl"
          >
            <h2 className="text-body-md-strong text-ink">{feature.title}</h2>
            <p className="text-body-sm text-body">{feature.body}</p>
          </article>
        ))}
      </div>
    </section>
  )
}
