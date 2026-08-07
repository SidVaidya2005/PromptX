import { Suspense } from 'react'
import Link from 'next/link'

import { PlusIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { ConversationList } from '@/components/sidebar/ConversationList'
import { ConversationListSkeleton } from '@/components/sidebar/ConversationListSkeleton'
import { CollapseToggle } from '@/components/shell/CollapseToggle'
import { ShowArchivedToggle } from '@/components/shell/ShowArchivedToggle'
import { SidebarFooter } from '@/components/shell/SidebarFooter'

import type { ConversationSummary, ShellUser } from '@/types/domain'

type SidebarProps = {
  user: ShellUser
  /** Still in flight. Awaited inside the Suspense boundary below, never here. */
  conversations: Promise<ConversationSummary[]>
  /**
   * Whether the promise above was asked for archived rows. Passed down rather
   * than derived, because the layout already read the cookie to build the
   * query and a second reading could disagree with it. (F22)
   */
  showArchived: boolean
}

/**
 * The conversation column — a Server Component with three client leaves.
 *
 * This file stays synchronous and only ConversationList awaits, behind a
 * Suspense boundary. That is what lets the three-column frame paint before the
 * conversation query resolves, and it is also what makes the skeleton real
 * rather than decorative: the layout has no loading.tsx of its own, so without
 * this boundary there would be no moment at which a fallback could render.
 *
 * This same element is rendered twice by AppShell: inline at desktop, and
 * inside the mobile drawer. Only one is ever visible, so nothing here may
 * assume it is unique on the page — no ids, no autofocus.
 */
export function Sidebar({ user, conversations, showArchived }: SidebarProps) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas">
      <div className="flex items-center justify-between gap-sm p-sm">
        <Link href="/chat" className="rounded-sm px-xs text-body-sm-strong text-ink">
          PromptX
        </Link>

        {/* Collapsing is a desktop-only idea — below 1024px this column is an
            overlay, and its close control is the drawer's own. */}
        <CollapseToggle column="sidebar" className="hidden desktop:inline-flex" />
      </div>

      <div className="p-sm">
        <Button asChild variant="primary" className="w-full justify-start">
          <Link href="/chat">
            <PlusIcon />
            New chat
          </Link>
        </Button>
      </div>

      {/* min-h-0 is what lets this scroll instead of pushing the footer off the
          bottom — a flex child's default min-height is auto, not zero. */}
      <nav aria-label="Conversations" className="min-h-0 flex-1 overflow-y-auto p-sm">
        <Suspense fallback={<ConversationListSkeleton />}>
          <ConversationList conversations={conversations} />
        </Suspense>
      </nav>

      {/* Above the account row and outside the scrolling <nav>, so revealing
          archived conversations does not require scrolling to the bottom of the
          list they are about to be added to. */}
      <div className="border-t border-hairline p-xs">
        <ShowArchivedToggle showArchived={showArchived} />
      </div>

      <SidebarFooter user={user} />
    </div>
  )
}
