/**
 * Bar widths, varied so the placeholder reads as a list of titles rather than a
 * block. Written as whole class names because Tailwind scans source text — a
 * width composed at runtime would never be generated.
 */
const ROW_WIDTHS = ['w-40', 'w-32', 'w-44', 'w-28', 'w-36'] as const

/**
 * What the sidebar shows while the conversation query is in flight.
 *
 * Not animated, for the same reason the centre column's skeleton is not: a
 * skeleton that pulses hard reads as slower than one that does not, and the
 * free Render instance already spends its first minute waking. Nothing here
 * needs a prefers-reduced-motion branch as a result.
 */
export function ConversationListSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading conversations"
      className="flex flex-col gap-xs pt-lg"
    >
      {ROW_WIDTHS.map((width) => (
        <div key={width} className="px-md py-sm">
          <div className={`h-4 ${width} rounded-sm bg-canvas-soft`} />
        </div>
      ))}
    </div>
  )
}
