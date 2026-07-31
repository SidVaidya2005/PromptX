import Link from 'next/link'

import { PlusIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { CollapseToggle } from '@/components/shell/CollapseToggle'
import { SidebarFooter } from '@/components/shell/SidebarFooter'

import type { ShellUser } from '@/types/domain'

type SidebarProps = {
  user: ShellUser
}

/**
 * The conversation column — a Server Component with two client leaves.
 *
 * The conversation list itself is feature 06's; the scrolling region between
 * the "New chat" button and the footer is deliberately empty until then rather
 * than filled with a placeholder that has to be torn out again.
 *
 * This same element is rendered twice by AppShell: inline at desktop, and
 * inside the mobile drawer. Only one is ever visible, so nothing here may
 * assume it is unique on the page — no ids, no autofocus.
 */
export function Sidebar({ user }: SidebarProps) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas">
      <div className="flex items-center justify-between gap-sm p-sm">
        <Link
          href="/chat"
          className="rounded-sm px-xs text-body-sm-strong text-ink"
        >
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
      <nav
        aria-label="Conversations"
        className="min-h-0 flex-1 overflow-y-auto p-sm"
      />

      <SidebarFooter user={user} />
    </div>
  )
}
