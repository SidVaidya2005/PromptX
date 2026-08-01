'use client'

import * as React from 'react'

import { AlertDialog as AlertDialogPrimitive } from 'radix-ui'

import { cn } from '@/lib/utils'

import { Button } from '@/components/ui/button'

/**
 * The confirmation surface for destructive actions.
 *
 * Deliberately distinct from `dialog.tsx` rather than a variant of it. Radix
 * gives this one `role="alertdialog"`, focuses the Cancel action on open rather
 * than the destructive one, and drops the outside-click dismissal — three
 * behaviours you want when the button on the other side deletes something, and
 * none of which a plain Dialog provides.
 *
 * The surface is identical to Dialog's on purpose: same overlay, same padded
 * grid wrapper, same modal-card tokens. Two confirmation shapes that looked
 * different would read as two different systems.
 *
 * There is no close button, and that is the point — an alert dialog is answered,
 * not dismissed by a corner X that means neither yes nor no. Escape and Cancel
 * are both still there.
 */
function AlertDialog({
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Root>) {
  return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />
}

function AlertDialogTrigger({
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Trigger>) {
  return <AlertDialogPrimitive.Trigger data-slot="alert-dialog-trigger" {...props} />
}

function AlertDialogPortal({
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Portal>) {
  return <AlertDialogPrimitive.Portal data-slot="alert-dialog-portal" {...props} />
}

function AlertDialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Overlay>) {
  return (
    <AlertDialogPrimitive.Overlay
      data-slot="alert-dialog-overlay"
      // DESIGN.md: the backdrop is the canvas at 70% opacity.
      className={cn('fixed inset-0 z-50 bg-canvas/70', className)}
      {...props}
    />
  )
}

function AlertDialogContent({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Content>) {
  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      {/* Centred by a padded grid wrapper rather than by a translate, so the
          gutter on a narrow viewport comes from a spacing token instead of an
          arbitrary calc() width. */}
      <div className="fixed inset-0 z-50 grid place-items-center p-lg">
        <AlertDialogPrimitive.Content
          data-slot="alert-dialog-content"
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
        />
      </div>
    </AlertDialogPortal>
  )
}

function AlertDialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-dialog-header"
      className={cn('flex flex-col gap-xs', className)}
      {...props}
    />
  )
}

function AlertDialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-dialog-footer"
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

function AlertDialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title
      data-slot="alert-dialog-title"
      className={cn('text-display-sm text-ink', className)}
      {...props}
    />
  )
}

function AlertDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn('text-body-sm text-body', className)}
      {...props}
    />
  )
}

/**
 * The destructive half. Defaults to the `danger` variant, which is transparent
 * with `text-danger` — never a solid fill, because a solid danger fill reads as
 * a primary call to action and this is the button that should give someone
 * pause.
 */
function AlertDialogAction({
  className,
  variant = 'danger',
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <AlertDialogPrimitive.Action asChild>
      <Button data-slot="alert-dialog-action" variant={variant} className={className} {...props} />
    </AlertDialogPrimitive.Action>
  )
}

/** Radix focuses this on open, which is why the destructive action is safe to sit beside it. */
function AlertDialogCancel({
  className,
  variant = 'outline',
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <AlertDialogPrimitive.Cancel asChild>
      <Button data-slot="alert-dialog-cancel" variant={variant} className={className} {...props} />
    </AlertDialogPrimitive.Cancel>
  )
}

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
  AlertDialogTrigger,
}
