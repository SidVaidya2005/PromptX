'use client'

import * as React from 'react'

import { Tooltip as TooltipPrimitive } from 'radix-ui'

import { cn } from '@/lib/utils'

function TooltipProvider({
  delayDuration = 0,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  )
}

function Tooltip({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />
}

function TooltipTrigger({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

function TooltipContent({
  className,
  sideOffset = 4,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          // Polarity-flipped for contrast: ink fill, canvas text. This is the
          // one surface in the system that inverts.
          // max-w-80 is 320px. NOT max-w-xs, which the spacing tokens shadow
          // down to 4px — see the spacing note in globals.css.
          'z-50 w-fit max-w-80 rounded-sm bg-ink px-sm py-xxs',
          'text-caption text-on-primary',
          className,
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="z-50 size-2 rotate-45 fill-ink" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger }
