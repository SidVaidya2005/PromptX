'use client'

import { useEffect, useRef, useState } from 'react'

import { CheckIcon, CopyIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

type CopyButtonProps = {
  /** What lands on the clipboard. Always the source, never rendered text. */
  value: string
  /** Names what is being copied, for anyone who cannot see the surrounding UI. */
  label: string
  className?: string
}

/** How long the confirmation stays up before the button returns to its idle state. */
const CONFIRMATION_MS = 1_500

/**
 * Copy-to-clipboard, shared by the code block header and the message meta row.
 *
 * Deliberately not the `Button` component: both call sites sit inside a
 * hover-revealed strip of `mute` text at `text-caption`, and Button's smallest
 * size is a 32px control with its own colour. This is a text-scale affordance.
 */
export function CopyButton({ value, label, className }: CopyButtonProps) {
  const [copied, setCopied] = useState(false)
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  // A code block can unmount mid-confirmation — a message re-render while
  // streaming is enough — and a timer left running would set state on a gone
  // component.
  useEffect(() => () => {
    if (timeout.current) clearTimeout(timeout.current)
  }, [])

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      // Denied permission or an insecure origin. Nothing here is worth
      // interrupting someone mid-conversation over, and the text is selectable
      // either way — so the button simply does not confirm.
      return
    }

    setCopied(true)

    if (timeout.current) clearTimeout(timeout.current)
    timeout.current = setTimeout(() => setCopied(false), CONFIRMATION_MS)
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      aria-label={copied ? `${label} copied` : label}
      className={cn(
        'inline-flex items-center gap-xs rounded-xs text-caption text-mute',
        'transition-colors hover:text-body-strong',
        'pointer-coarse:min-h-11 pointer-coarse:px-sm',
        className,
      )}
    >
      {copied ? (
        <CheckIcon aria-hidden className="size-3.5" />
      ) : (
        <CopyIcon aria-hidden className="size-3.5" />
      )}
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}
