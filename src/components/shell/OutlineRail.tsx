import { CollapseToggle } from '@/components/shell/CollapseToggle'

/**
 * The right column: the user's own prompts in the current conversation.
 *
 * Empty at feature 05 — the jump targets arrive with feature 18, which also
 * adds DESIGN.md's rule that the rail hides entirely below three exchanges.
 * That rule is deliberately not implemented yet: with no messages in the system
 * it would mean "always hidden", which would leave the column's collapse
 * behaviour shipped but unverifiable until Phase 3.
 */
export function OutlineRail() {
  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas">
      <div className="flex items-center justify-between gap-sm p-sm">
        <h2 className="px-xs text-caption text-mute">Outline</h2>

        <CollapseToggle column="rail" className="hidden desktop:inline-flex" />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-sm">
        <p className="px-xs text-body-sm text-mute">
          Your prompts in this conversation will appear here.
        </p>
      </div>
    </div>
  )
}
