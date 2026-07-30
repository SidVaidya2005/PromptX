import * as React from 'react'

import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from 'radix-ui'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  // text-button-md already carries size, weight, and line-height together, so it
  // is never paired with a font-*/leading-* class. No outline-none anywhere: the
  // focus ring is the base-layer :focus-visible outline in globals.css, and
  // suppressing it here would remove the only focus affordance.
  'inline-flex shrink-0 items-center justify-center gap-xs rounded-sm ' +
    'text-button-md whitespace-nowrap transition-colors select-none ' +
    'disabled:pointer-events-none disabled:opacity-50 ' +
    // The WCAG 44px floor keys off pointer type, never off a breakpoint — an
    // iPad in landscape gets the desktop layout and still has no fine pointer.
    'pointer-coarse:min-h-11 ' +
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // Off-white fill on warm dark — the only "primary colour" in the system.
        primary: 'bg-primary text-on-primary hover:bg-body-strong',
        ghost: 'bg-transparent text-ink hover:bg-canvas-soft',
        outline: 'border border-hairline bg-transparent text-ink hover:bg-canvas-soft',
        // State-only, and never a solid danger fill — that reads as a primary CTA.
        danger: 'bg-transparent text-danger hover:bg-danger/10',
      },
      size: {
        sm: 'h-8 px-md',
        md: 'h-9 px-lg',
        // rounded-pill is reserved for icon containers and status chips.
        icon: 'size-9 rounded-pill pointer-coarse:size-11',
      },
    },
    defaultVariants: { variant: 'ghost', size: 'md' },
  },
)

type ButtonProps = React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }

function Button({
  className,
  variant = 'ghost',
  size = 'md',
  asChild = false,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot.Root : 'button'

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
export type { ButtonProps }
