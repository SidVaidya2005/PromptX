/**
 * The library's skeleton, which `code-standards.md` names `/prompts` as needing.
 *
 * Shaped like the grid rather than like the group-level skeleton, so the frame
 * does not visibly change shape when the prompts arrive: heading, controls row,
 * then card-sized blocks at the same three breakpoints the grid uses.
 *
 * No animation, so nothing here needs a prefers-reduced-motion branch — the same
 * reasoning the shell's own loading state records.
 */
export default function PromptsLoading() {
  return (
    <div
      role="status"
      aria-label="Loading prompts"
      className="mx-auto w-full max-w-260 px-lg py-xl tablet:px-xl"
    >
      <div className="h-8 w-40 rounded-sm bg-canvas-soft" />
      <div className="mt-sm h-4 w-full max-w-180 rounded-sm bg-canvas-soft" />

      <div className="mt-xl h-9 w-full rounded-sm bg-canvas-soft" />

      <div className="mt-xl grid gap-lg tablet:grid-cols-2 desktop:grid-cols-3">
        {[0, 1, 2].map((index) => (
          <div key={index} className="h-40 rounded-md border border-hairline bg-canvas-soft" />
        ))}
      </div>
    </div>
  )
}
