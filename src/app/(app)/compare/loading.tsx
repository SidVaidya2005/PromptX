/**
 * The compare page's skeleton.
 *
 * Shaped like the page rather than as a generic block, so the frame does not
 * move when the real thing arrives: the prompt panel across the top, then two
 * equal columns with the hairline already between them. The three reads behind
 * this page are fast, but the shape is what stops a flash of layout.
 *
 * No animation, so nothing here needs a prefers-reduced-motion branch.
 */
export default function CompareLoading() {
  return (
    <div role="status" aria-label="Loading compare" className="flex h-full flex-col">
      <div className="border-b border-hairline px-lg py-lg tablet:px-xl">
        <div className="mx-auto flex w-full max-w-240 flex-col gap-sm">
          <div className="h-7 w-28 rounded-sm bg-canvas-soft" />
          <div className="h-16 w-full rounded-md bg-canvas-soft" />
          <div className="h-8 w-24 self-end rounded-sm bg-canvas-soft" />
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 desktop:grid-cols-2">
        <div className="border-b border-hairline desktop:border-b-0 desktop:border-r">
          <div className="border-b border-hairline px-lg py-sm">
            <div className="h-8 w-40 rounded-sm bg-canvas-soft" />
          </div>
        </div>

        <div>
          <div className="border-b border-hairline px-lg py-sm">
            <div className="h-8 w-40 rounded-sm bg-canvas-soft" />
          </div>
        </div>
      </div>
    </div>
  )
}
