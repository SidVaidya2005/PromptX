'use client'

import { createContext, useContext } from 'react'

/**
 * The shell's collapse state, shared by context rather than by props.
 *
 * Context is what makes this work at all. `AppShell` receives the sidebar and
 * the outline rail as already-rendered Server Component nodes, so it cannot
 * hand them a callback — a Server Component takes no function props. But the
 * collapse toggle belongs visually inside each column's own header, not
 * floating beside it. Context crosses that boundary: the server-rendered
 * sidebar contains a small client leaf, and at runtime the whole thing is one
 * React tree, so the leaf reads the provider above it.
 */
export type ShellState = {
  sidebarCollapsed: boolean
  railCollapsed: boolean
  toggleSidebar: () => void
  toggleRail: () => void
}

export const ShellContext = createContext<ShellState | null>(null)

export function useShell(): ShellState {
  const state = useContext(ShellContext)

  if (!state) {
    throw new Error('useShell must be called inside the (app) shell')
  }

  return state
}
