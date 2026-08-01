'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { cn } from '@/lib/utils'

type SettingsNavProps = {
  items: readonly { href: string; label: string }[]
}

/**
 * The Keys / Account switcher.
 *
 * A client leaf purely because the active item comes from `usePathname`. The
 * layout around it stays a Server Component, so this ships the smallest possible
 * amount of JavaScript for the one thing that genuinely needs the client — the
 * same split the shell uses for its collapse toggles.
 */
export function SettingsNav({ items }: SettingsNavProps) {
  const pathname = usePathname()

  return (
    <nav aria-label="Settings sections">
      <ul className="flex gap-xs border-b border-hairline">
        {items.map((item) => {
          const isActive = pathname === item.href

          return (
            <li key={item.href}>
              <Link
                href={item.href}
                // aria-current is the accessible half of the underline. Without
                // it the active section is conveyed by colour and a border
                // alone, which a screen reader cannot report.
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'inline-flex items-center border-b-2 px-md py-sm text-body-sm-strong',
                  'transition-colors',
                  'focus-visible:ring-1 focus-visible:ring-primary focus-visible:ring-offset-2',
                  'focus-visible:ring-offset-canvas focus-visible:outline-none',
                  'pointer-coarse:min-h-11',
                  isActive
                    ? 'border-primary text-ink'
                    : 'border-transparent text-mute hover:text-body-strong',
                )}
              >
                {item.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
