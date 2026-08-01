'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { cn } from '@/lib/utils'

type ConversationRowProps = {
  id: string
  title: string
  /** The raw timestamp, for <time datetime>. Machine-readable, unlike the label. */
  updatedAt: string
  /** Already formatted on the server, so nothing here depends on the clock. */
  relativeTime: string
}

/**
 * One conversation. The only part of the list that ships to the browser.
 *
 * It is a Client Component for one reason: a layout cannot read the params of a
 * child segment, so the sidebar has no way to learn which conversation is open
 * except from the URL. usePathname() is that route — the same mechanism AppShell
 * already uses to close the mobile drawer on navigation.
 *
 * Everything else — the query, the grouping, the time formatting — stays on the
 * server and arrives as props.
 */
export function ConversationRow({
  id,
  title,
  updatedAt,
  relativeTime,
}: ConversationRowProps) {
  const isActive = usePathname() === `/chat/${id}`

  return (
    <li>
      <Link
        href={`/chat/${id}`}
        aria-current={isActive ? 'page' : undefined}
        className={cn(
          'group relative flex items-center gap-sm rounded-sm px-md py-sm text-body-sm',
          // The 44px floor keys off pointer type, never off a breakpoint.
          'pointer-coarse:min-h-11',
          isActive ? 'bg-canvas-soft text-ink' : 'text-body-strong hover:bg-canvas-soft',
        )}
      >
        {isActive && (
          <span aria-hidden className="absolute inset-y-xs left-0 w-0.5 bg-primary" />
        )}

        <span className="min-w-0 flex-1 truncate">{title}</span>

        {/* Kept in the layout at all times, only faded, so the title's
            truncation point does not jump when a pointer enters the row.
            The coarse-pointer case is not a nicety: with no hover there is
            otherwise no way to reach this at all. */}
        <time
          dateTime={updatedAt}
          className="shrink-0 text-caption text-mute opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 pointer-coarse:opacity-100"
        >
          {relativeTime}
        </time>
      </Link>
    </li>
  )
}
