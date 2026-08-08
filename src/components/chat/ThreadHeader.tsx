'use client'

import { useState } from 'react'

import { EllipsisIcon, Share2Icon } from 'lucide-react'

import { ShareDialog } from '@/components/chat/ShareDialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

type ThreadHeaderProps = {
  conversationId: string
  title: string
  /** The slug from the row on load. Null means not shared. */
  initialShareSlug: string | null
}

/**
 * The conversation's own chrome: what it is called, and what can be done to it
 * as a whole. (F33)
 *
 * **New, because §33's "thread header" did not exist.** `AppShell` has one, but
 * it is `desktop:hidden` shell chrome carrying the mobile sidebar and outline
 * triggers — and it renders on `/prompts`, `/search` and `/compare` too, so
 * putting a share control there would offer it on three routes with no
 * conversation to share. This one belongs to the thread, appears at every width,
 * and only on `/chat/[id]`.
 *
 * The overflow menu is deliberately a menu with one item today. §34 puts export
 * in it, which is the reason it is a menu rather than a bare share button — a
 * control that has to become a menu one feature later is worth being one now.
 *
 * The slug is state here rather than in the dialog, seeded from the row. The
 * dialog unmounts on close (F24's rule), so a slug living there would be
 * forgotten every time it closed, and reopening would show "not shared" for a
 * conversation with a live link until the next server render.
 */
export function ThreadHeader({
  conversationId,
  title,
  initialShareSlug,
}: ThreadHeaderProps) {
  const [shareSlug, setShareSlug] = useState(initialShareSlug)
  const [isDialogOpen, setIsDialogOpen] = useState(false)

  return (
    <header className="flex items-center justify-between gap-sm border-b border-hairline px-lg py-sm">
      <div className="flex min-w-0 items-center gap-sm">
        <h1 className="truncate text-body-md text-ink">{title}</h1>

        {/* DESIGN.md `status-chip`, which names "Shared" as one of its three.
            Persistent rather than hover-revealed, and it is the only thing on
            this screen that says the conversation is readable by strangers. */}
        {shareSlug && (
          <span className="flex shrink-0 items-center gap-xxs rounded-full border border-hairline px-sm py-xxs text-caption text-mute">
            <Share2Icon className="size-3" aria-hidden />
            Shared
          </span>
        )}
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Conversation options">
            <EllipsisIcon />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setIsDialogOpen(true)}>
            {shareSlug ? 'Manage share link' : 'Share…'}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {isDialogOpen && (
        <ShareDialog
          conversationId={conversationId}
          shareSlug={shareSlug}
          onOpenChange={(open) => !open && setIsDialogOpen(false)}
          onSlugChange={setShareSlug}
        />
      )}
    </header>
  )
}
