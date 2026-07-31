'use client'

import Link from 'next/link'

import { LogOutIcon, MoreHorizontalIcon, SettingsIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { UserAvatar } from '@/components/shell/UserAvatar'

import type { ShellUser } from '@/types/domain'

type SidebarFooterProps = {
  user: ShellUser
}

/**
 * Avatar, name, and the account menu — the bottom of the sidebar.
 *
 * Sign-out is a POST because /auth/signout only answers POST, and that is
 * deliberate: a GET sign-out is firable by any prefetch, any <img> tag, and any
 * link a third-party page can get a browser to follow.
 */
export function SidebarFooter({ user }: SidebarFooterProps) {
  /**
   * Radix closes the menu when an item is selected, which unmounts the submit
   * button before the browser acts on the click — the form would never be
   * submitted. Suppressing the auto-close and submitting the form directly
   * removes the race rather than betting on the event order.
   */
  function handleSignOut(event: Event) {
    event.preventDefault()

    const item = event.currentTarget
    if (item instanceof HTMLElement) {
      item.closest('form')?.requestSubmit()
    }
  }

  return (
    <div className="flex items-center gap-sm border-t border-hairline px-md py-sm">
      <UserAvatar displayName={user.displayName} avatarUrl={user.avatarUrl} />

      <p className="min-w-0 flex-1 truncate text-body-sm text-body-strong">
        {user.displayName}
      </p>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Account menu">
            <MoreHorizontalIcon />
          </Button>
        </DropdownMenuTrigger>

        {/* Opens upward: the trigger sits at the bottom edge of the viewport. */}
        <DropdownMenuContent side="top" align="end" className="min-w-56">
          <DropdownMenuLabel className="truncate">{user.email}</DropdownMenuLabel>

          <DropdownMenuSeparator />

          <DropdownMenuItem asChild>
            <Link href="/settings/keys">
              <SettingsIcon />
              Settings
            </Link>
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <form action="/auth/signout" method="post">
            <DropdownMenuItem asChild onSelect={handleSignOut}>
              <button type="submit" className="w-full">
                <LogOutIcon />
                Sign out
              </button>
            </DropdownMenuItem>
          </form>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
