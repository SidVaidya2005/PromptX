import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * tailwind-merge has to be taught this project's scales, or it silently
 * corrupts them.
 *
 * Out of the box it knows Tailwind's default class groups and nothing else, so
 * against the DESIGN.md tokens it made two distinct mistakes:
 *
 *   1. It could not tell a custom type step from a custom text colour, so
 *      `cn('text-button-md', 'text-on-primary')` resolved them as one conflict
 *      and DROPPED the type step — every button rendered at the inherited
 *      16px/400 instead of 14px/500.
 *   2. It did not recognise `rounded-pill` at all, so `cn('rounded-sm',
 *      'rounded-pill')` kept BOTH and left the winner to CSS source order.
 *
 * Both failures are silent. Any token added to globals.css must be added here
 * too, or it will be quietly unreliable wherever cn() composes it.
 */

/** Every `--text-*` step in globals.css. These are font sizes, not colours. */
const TYPE_STEPS = [
  'display-xl',
  'display-lg',
  'display-md',
  'display-sm',
  'display-serif',
  'body-lg',
  'body-md',
  'body-md-strong',
  'body-sm',
  'body-sm-strong',
  'caption',
  'code',
  'code-md',
  'button-md',
] as const

/** Every `--radius-*` step in globals.css. */
const RADII = ['none', 'xxs', 'xs', 'sm', 'md', 'lg', 'pill'] as const

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: [...TYPE_STEPS] }],
      rounded: [{ rounded: [...RADII] }],
    },
  },
})

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

/**
 * Narrows a caller-supplied redirect target to a same-site path.
 *
 * `//evil.com` and `/\evil.com` are protocol-relative URLs that a bare
 * `startsWith('/')` check waves straight through. On /auth/callback that would
 * be an open redirect that arrives carrying a freshly minted session, which is
 * why this is a guard rather than a convenience.
 */
export function safeRedirectPath(target: string | null | undefined, fallback: string): string {
  if (!target) return fallback

  const isSameSitePath =
    target.startsWith('/') && !target.startsWith('//') && !target.startsWith('/\\')

  return isSameSitePath ? target : fallback
}
