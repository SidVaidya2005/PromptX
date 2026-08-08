/**
 * The search page's skeleton, which `code-standards.md` names `/search` as
 * needing.
 *
 * Shaped like the result list rather than the generic group skeleton, so the
 * frame does not change shape when matches arrive: heading, the field, then
 * row-height blocks separated the way the hairlines separate real rows.
 *
 * No animation, so nothing here needs a prefers-reduced-motion branch.
 */
export default function SearchLoading() {
  return (
    <div
      role="status"
      aria-label="Searching"
      className="mx-auto w-full max-w-180 px-lg py-xl tablet:px-xl"
    >
      <div className="h-8 w-32 rounded-sm bg-canvas-soft" />
      <div className="mt-lg h-11 w-full rounded-sm bg-canvas-soft" />

      <div className="mt-xl flex flex-col gap-lg">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="flex flex-col gap-xs border-b border-hairline pb-lg">
            <div className="h-3 w-16 rounded-sm bg-canvas-soft" />
            <div className="h-4 w-full rounded-sm bg-canvas-soft" />
            <div className="h-4 w-3/4 rounded-sm bg-canvas-soft" />
          </div>
        ))}
      </div>
    </div>
  )
}
