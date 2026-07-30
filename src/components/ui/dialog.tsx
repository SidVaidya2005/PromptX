'use client'

import * as React from 'react'

import { XIcon } from 'lucide-react'
import { Dialog as DialogPrimitive } from 'radix-ui'

import { cn } from '@/lib/utils'

import { Button } from '@/components/ui/button'

function Dialog({ ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ ...props }: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      // DESIGN.md: the backdrop is the canvas at 70% opacity.
      className={cn('fixed inset-0 z-50 bg-canvas/70', className)}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
}) {
  return (
    <DialogPortal>
      <DialogOverlay />
      {/* Centred by a padded grid wrapper rather than by a translate, so the
          gutter on a narrow viewport comes from a spacing token instead of an
          arbitrary calc() width. */}
      <div className="fixed inset-0 z-50 grid place-items-center p-lg">
        <DialogPrimitive.Content
          data-slot="dialog-content"
          className={cn(
            // Overlays are the only surface permitted a shadow. Everything else
            // builds elevation from surface contrast and a hairline.
            // max-w-112 is 448px. NOT max-w-md — the DESIGN.md spacing tokens
            // shadow Tailwind's container scale, so `max-w-md` would silently
            // resolve to --spacing-md and render a 10px-wide dialog.
            'relative grid w-full max-w-112 gap-lg rounded-lg border border-hairline',
            'bg-canvas-soft p-xl text-body-md text-ink shadow-lg',
            className,
          )}
          {...props}
        >
          {children}
          {showCloseButton && (
            <DialogPrimitive.Close data-slot="dialog-close" asChild>
              <Button variant="ghost" size="icon" className="absolute top-sm right-sm">
                <XIcon />
                <span className="sr-only">Close</span>
              </Button>
            </DialogPrimitive.Close>
          )}
        </DialogPrimitive.Content>
      </div>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-header"
      className={cn('flex flex-col gap-xs', className)}
      {...props}
    />
  )
}

function DialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-footer"
      // Stacked on mobile, inline from the tablet boundary. These are the only
      // two responsive prefixes that exist.
      className={cn(
        'flex flex-col-reverse gap-sm tablet:flex-row tablet:justify-end',
        className,
      )}
      {...props}
    />
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('text-display-sm text-ink', className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn('text-body-sm text-body', className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
