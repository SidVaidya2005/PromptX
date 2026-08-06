'use client'

import { cn } from '@/lib/utils'

import { CollapseToggle } from '@/components/shell/CollapseToggle'
import { useOutline } from '@/components/shell/use-outline'

/**
 * The right column: the user's own prompts in the current conversation.
 *
 * A Client Component, unlike the sidebar beside it. The shell hands both columns
 * to `AppShell` as rendered Server Component nodes so their markup stays in the
 * RSC payload rather than the client bundle — but that reasoning does not reach
 * this file, because the rail has no server markup to keep. Its content is
 * derived from `useChat` state that only exists in the browser, so there is
 * nothing a server render could have emitted. The sidebar's arrangement is
 * unchanged.
 *
 * `AppShell` decides whether this column exists at all; by the time this renders
 * there are at least three entries. The empty branch below is for the frame
 * between mount and the first publish, not for a short conversation.
 */
export function OutlineRail() {
  const { entries, activeId, jumpTo } = useOutline()

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas">
      <div className="flex items-center justify-between gap-sm p-sm">
        <h2 className="px-xs text-caption text-mute">Outline</h2>

        <CollapseToggle column="rail" className="hidden desktop:inline-flex" />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-sm">
        {/* aria-label rather than aria-labelledby: below 1024px this list is in
            the document twice, so the heading it would point at is too, and an
            id referenced twice resolves to whichever came first. */}
        <ul aria-label="Your prompts in this conversation" className="flex flex-col">
          {entries.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                onClick={() => jumpTo(entry.id)}
                // The active marker, and the only thing distinguishing this item.
                // Never an `id` — two copies of this list exist below 1024px.
                aria-current={entry.id === activeId ? 'true' : undefined}
                className={cn(
                  'w-full cursor-pointer rounded-sm border-l-2 border-transparent',
                  'px-sm py-xs text-left text-body-sm text-mute',
                  'transition-colors hover:text-body-strong',
                  entry.id === activeId && 'border-primary text-ink',
                )}
              >
                {/* DESIGN.md truncates this to two lines. The string arrived
                    already cut to a character budget, so a long paste is not
                    rendered in full — twice — to show two lines of it.

                    The fallback is what gives a contentless prompt an accessible
                    name. `toOutlineEntries` keeps an empty message on purpose —
                    it still holds a position in the thread — and a button with no
                    text is unreachable by name and looks like a rendering bug. */}
                <span className="line-clamp-2">{entry.label || 'Empty prompt'}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
