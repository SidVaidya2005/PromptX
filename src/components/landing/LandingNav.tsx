/**
 * The landing top nav. No links: there is exactly one action on this page and
 * it lives in the hero, so a second route out would only dilute it.
 */
export function LandingNav() {
  return (
    <header className="border-b border-hairline">
      <nav className="mx-auto flex max-w-300 items-center justify-between px-xl py-md">
        <span className="text-body-sm-strong text-ink">PromptX</span>
        <span className="font-mono text-code text-mute">bring your own key</span>
      </nav>
    </header>
  )
}
