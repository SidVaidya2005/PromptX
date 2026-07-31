'use client'

import * as React from 'react'

import { cva, type VariantProps } from 'class-variance-authority'
import { XIcon } from 'lucide-react'
import { Dialog as SheetPrimitive } from 'radix-ui'

import { cn } from '@/lib/utils'

import { Button } from '@/components/ui/button'

/**
 * An edge-anchored dialog — the shell's mobile drawer and outline sheet.
 *
 * Built on Radix's Dialog rather than a bespoke overlay so it inherits the
 * focus trap, the Escape handler, scroll locking, and `aria-modal` for free.
 * Everything below 1024px that slides in from an edge is this component; it is
 * not a second dialog vocabulary.
 *
 * Width is NOT baked into the variant. The two callers differ (the sidebar is
 * 260px, the outline rail 220px), so each passes its own numeric width — never
 * a named one, which the DESIGN.md spacing tokens shadow.
 */

const sheetVariants = cva(
  // Entry motion only. There is deliberately no `data-[state=closed]:animate-*`
  // here: Radix defers unmounting to an `animationend` whenever the computed
  // animation-name changes on close, and when that event does not arrive the
  // overlay unmounts while this panel stays on top of the page. Leaving the
  // closed state un-animated keeps the computed name `none`, so Radix unmounts
  // straight away. See the Motion block in globals.css.
  'fixed inset-y-0 z-50 flex flex-col border-hairline bg-canvas ' +
    // Overlays are the one surface DESIGN.md permits a shadow on.
    'shadow-lg',
  {
    variants: {
      side: {
        left: 'left-0 border-r data-[state=open]:animate-sheet-in-left',
        right: 'right-0 border-l data-[state=open]:animate-sheet-in-right',
      },
    },
    defaultVariants: { side: 'left' },
  },
)

function Sheet({ ...props }: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger({ ...props }: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetPortal({ ...props }: React.ComponentProps<typeof SheetPrimitive.Portal>) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />
}

function SheetClose({ ...props }: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      // DESIGN.md: the backdrop is the canvas at 70% opacity.
      className={cn('fixed inset-0 z-50 bg-canvas/70', className)}
      {...props}
    />
  )
}

function SheetContent({
  className,
  children,
  side = 'left',
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> &
  VariantProps<typeof sheetVariants> & {
    showCloseButton?: boolean
  }) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        className={cn(sheetVariants({ side }), className)}
        {...props}
      >
        {children}
        {showCloseButton && (
          <SheetPrimitive.Close data-slot="sheet-close" asChild>
            <Button variant="ghost" size="icon" className="absolute top-sm right-sm">
              <XIcon />
              <span className="sr-only">Close</span>
            </Button>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Content>
    </SheetPortal>
  )
}

/**
 * Required by Radix even when the panel shows no visible heading — without a
 * title the dialog has no accessible name and Radix logs a warning. Wrap it in
 * SheetPrimitive.Title's `sr-only` form at the call site when the design has no
 * room for a visible one.
 */
function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn('text-body-sm-strong text-ink', className)}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn('text-body-sm text-body', className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetOverlay,
  SheetPortal,
  SheetTitle,
  SheetTrigger,
}
