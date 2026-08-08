'use client'

import * as React from 'react'

import { Popover as PopoverPrimitive } from 'radix-ui'

import { cn } from '@/lib/utils'

/**
 * An anchored panel that holds arbitrary content. (F25)
 *
 * Vendored from `radix-ui`, which is already a dependency — this is a new file,
 * not a new package, the same terms every other primitive in this folder is on.
 *
 * It exists because a `DropdownMenu` cannot hold a text input. Radix menus own
 * typing for their own typeahead and the arrow keys for item navigation, so a
 * filter field inside one fights the primitive rather than using it. A popover
 * claims neither, which leaves both available to whatever is rendered inside.
 *
 * **Non-modal by default**, unlike `Dialog`: the page behind stays scrollable
 * and readable, which is right for a control anchored to a toolbar rather than
 * one demanding an answer.
 *
 * **No exit animation, and that is a rule rather than an omission.** Radix
 * defers unmounting a closing element to an `animationend` whenever the computed
 * `animation-name` changes on close; when that event never arrives the panel
 * stays on screen, visible and interactive, over a page that thinks it closed.
 * Observed at F05 with the sheet. With no exit keyframe the name stays `none`
 * and Radix unmounts immediately. A CSS transition is not a substitute — Radix
 * listens for `animationend`, never `transitionend`.
 */

function Popover({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

function PopoverTrigger({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

function PopoverAnchor({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />
}

function PopoverContent({
  className,
  align = 'start',
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          // The dropdown-menu surface, deliberately identical: two overlay
          // shapes that looked different would read as two systems, which is
          // the argument alert-dialog.tsx already makes about its own surface.
          // Overlays are the one place DESIGN.md permits a shadow.
          'z-50 rounded-md border border-hairline bg-canvas-soft p-xs shadow-lg',
          // Radix measures the space between the trigger and the viewport edge
          // and publishes it; without this the panel can extend past the bottom
          // of a short window with no way to reach what is below the fold.
          'max-h-(--radix-popover-content-available-height)',
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}

export { Popover, PopoverAnchor, PopoverContent, PopoverTrigger }
