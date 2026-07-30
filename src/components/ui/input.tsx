import * as React from 'react'

import { cn } from '@/lib/utils'

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        // DESIGN.md `text-input`: canvas-soft fill, hairline border, body-sm,
        // rounded-sm, 8px/10px padding. The 36px height is that padding plus the
        // 20px line-height, which is the standard control height across the app.
        'h-9 w-full min-w-0 rounded-sm border border-hairline bg-canvas-soft px-md',
        'text-body-sm text-ink transition-colors placeholder:text-mute',
        'disabled:pointer-events-none disabled:opacity-50',
        'pointer-coarse:min-h-11',
        className,
      )}
      {...props}
    />
  )
}

export { Input }
