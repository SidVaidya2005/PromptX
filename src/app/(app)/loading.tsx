/**
 * The centre column's skeleton.
 *
 * Rendered inside the shell, so the sidebar stays put while a route resolves —
 * only the thread area is replaced. Quiet on purpose: a skeleton that pulses
 * hard reads as slower than one that does not, and the free Render instance
 * already spends its first minute waking.
 *
 * No animation, so nothing here needs a prefers-reduced-motion branch.
 */
export default function AppLoading() {
  return (
    <div
      role="status"
      aria-label="Loading"
      className="mx-auto flex h-full max-w-180 flex-col gap-lg p-3xl"
    >
      <div className="h-5 w-48 rounded-sm bg-canvas-soft" />
      <div className="h-4 w-full rounded-sm bg-canvas-soft" />
      <div className="h-4 w-3/4 rounded-sm bg-canvas-soft" />
    </div>
  )
}
