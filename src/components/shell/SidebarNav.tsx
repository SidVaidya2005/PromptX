'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { LibraryIcon, SearchIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * The workspace links, between "New chat" and the conversation list. (F24)
 *
 * `project-overview.md` has said since Phase 0 that the sidebar "holds the links
 * to Prompts, Search, and Settings", and F05 built only the last of those, in
 * the account menu. F24 needs the first, so the slot is built once here rather
 * than three times: F27's Search and F31's Compare are entries in this array.
 *
 * A client leaf purely for `usePathname`, which is the split `SettingsNav` uses
 * — `Sidebar` stays a Server Component, so its markup stays in the RSC payload
 * and nothing about F05's slotting arrangement moves.
 *
 * Nothing here carries a hand-written `id`. Below 1024px this column is in the
 * document twice, once as the `display:none` desktop aside and once inside the
 * mounted drawer, so every id would exist twice. The group is named with
 * `aria-label`, never `aria-labelledby`.
 */

const LINKS = [
  { href: '/prompts', label: 'Prompts', icon: LibraryIcon },
  { href: '/search', label: 'Search', icon: SearchIcon },
] as const

export function SidebarNav() {
  const pathname = usePathname()

  return (
    <nav aria-label="Workspace">
      <ul className="flex flex-col gap-xxs">
        {LINKS.map((link) => {
          // startsWith rather than equality, so a future detail route under one
          // of these still marks its own entry. `/prompts` has no children
          // today; `/settings` is the shape this is written for.
          const isActive = pathname === link.href || pathname.startsWith(`${link.href}/`)
          const Icon = link.icon

          return (
            <li key={link.href}>
              <Link
                href={link.href}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-sm rounded-sm px-sm py-xs text-body-sm',
                  'transition-colors',
                  'pointer-coarse:min-h-11',
                  isActive
                    ? 'bg-canvas-soft text-ink'
                    : 'text-body hover:bg-canvas-soft hover:text-ink',
                )}
              >
                <Icon className="size-4 shrink-0 text-mute" aria-hidden />
                {link.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
