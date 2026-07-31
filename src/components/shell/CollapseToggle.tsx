'use client'

import { PanelLeftIcon, PanelRightIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

import { Button } from '@/components/ui/button'
import { useShell } from '@/components/shell/use-shell'

type CollapseToggleProps = {
  column: 'sidebar' | 'rail'
  className?: string
}

/**
 * Collapses or restores one of the two side columns.
 *
 * Rendered in three places per column: inside the column's own header, and
 * inside the narrow gutter strip that remains once it is collapsed. Both are
 * desktop-only — below 1024px the columns are overlays and collapsing them is
 * meaningless, which is why every caller pairs this with `hidden desktop:*`.
 */
export function CollapseToggle({ column, className }: CollapseToggleProps) {
  const { sidebarCollapsed, railCollapsed, toggleSidebar, toggleRail } = useShell()

  const isSidebar = column === 'sidebar'
  const collapsed = isSidebar ? sidebarCollapsed : railCollapsed
  const onToggle = isSidebar ? toggleSidebar : toggleRail
  const label = isSidebar ? 'conversation sidebar' : 'outline rail'
  const Icon = isSidebar ? PanelLeftIcon : PanelRightIcon

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={onToggle}
      // aria-expanded rather than a changing label: assistive tech announces the
      // state change, and the accessible name stays stable between presses.
      aria-expanded={!collapsed}
      aria-label={collapsed ? `Show the ${label}` : `Hide the ${label}`}
      className={cn(className)}
    >
      <Icon />
    </Button>
  )
}
