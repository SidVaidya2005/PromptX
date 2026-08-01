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

/** Every `--animate-*` token in globals.css. Only the sheet entry motion exists. */
const ANIMATIONS = ['sheet-in-left', 'sheet-in-right'] as const

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: [...TYPE_STEPS] }],
      rounded: [{ rounded: [...RADII] }],
      animate: [{ animate: [...ANIMATIONS] }],
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
export function safeRedirectPath(
  target: string | null | undefined,
  fallback: string,
): string {
  if (!target) return fallback

  const isSameSitePath =
    target.startsWith('/') && !target.startsWith('//') && !target.startsWith('/\\')

  return isSameSitePath ? target : fallback
}

/**
 * The plain text of a UI message.
 *
 * A message is a list of parts, not a string — `message.content` does not exist
 * in AI SDK v5 and later. Parts can be text, reasoning, or files, and only the
 * text ones belong in `messages.content`, so the rest are dropped rather than
 * stringified into the column that feeds full-text search.
 *
 * Typed structurally rather than against `ChatRequestMessage`, so feature 08 can
 * hand it a real `UIMessage` without a cast.
 */
export function textOf(message: {
  parts: ReadonlyArray<{ type: string; text?: string | undefined }>
}): string {
  return message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text ?? '')
    .join('')
}

/**
 * The name to show for a person, in descending order of what they chose.
 *
 * `profiles.display_name` is nullable and editable, so it can be absent at
 * signup or blanked later. The email's local part is the fallback rather than
 * the full address, because the sidebar footer is 260px wide and a long address
 * truncates to nothing recognisable.
 */
export function resolveDisplayName(
  displayName: string | null | undefined,
  email: string,
): string {
  const trimmed = displayName?.trim()
  if (trimmed) return trimmed

  const localPart = email.split('@')[0]?.trim()
  return localPart || email
}

/**
 * The single character for an avatar fallback.
 *
 * Uses the string iterator rather than `charAt(0)`, so an emoji or any other
 * astral-plane character yields the whole code point instead of half a
 * surrogate pair, which renders as a replacement glyph.
 */
export function initialOf(name: string): string {
  const first = [...name.trim()][0]
  return first ? first.toUpperCase() : '?'
}
