'use client'

import { useState } from 'react'
import Image from 'next/image'

import { initialOf } from '@/lib/utils'

type UserAvatarProps = {
  displayName: string
  avatarUrl: string | null
}

/** DESIGN.md: avatars are 1:1 inside rounded-full, 24px in the sidebar footer. */
const AVATAR_SIZE = 24

/**
 * The person's Google photo, falling back to their initial.
 *
 * Two independent reasons the image may not render, and both are ordinary
 * rather than exceptional: `avatar_url` is nullable, and Google's photo URLs
 * rotate, so a stored one can start 404ing at any time. `onError` covers the
 * second — without it a broken image icon sits in the sidebar permanently.
 *
 * `unoptimized` is an invariant, not a tuning choice: Render runs the Next
 * image optimizer inside the same single process that serves streams, and its
 * disk cache does not survive a redeploy. Explicit width and height keep the
 * footer from shifting as the image loads.
 */
export function UserAvatar({ displayName, avatarUrl }: UserAvatarProps) {
  const [failed, setFailed] = useState(false)

  if (!avatarUrl || failed) {
    return (
      <span
        aria-hidden="true"
        className="flex size-6 shrink-0 items-center justify-center rounded-pill bg-canvas-soft text-caption text-body"
      >
        {initialOf(displayName)}
      </span>
    )
  }

  return (
    <Image
      unoptimized
      // next/image lazy-loads by default, which for 24px of permanent chrome
      // buys nothing and leaves the footer empty until an observer fires.
      loading="eager"
      src={avatarUrl}
      alt=""
      width={AVATAR_SIZE}
      height={AVATAR_SIZE}
      onError={() => setFailed(true)}
      className="size-6 shrink-0 rounded-pill object-cover"
    />
  )
}
