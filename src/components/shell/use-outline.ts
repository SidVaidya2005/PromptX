'use client'

import { createContext, useContext } from 'react'

import type { OutlineEntry } from '@/lib/outline'

/**
 * The channel between the thread and the rail.
 *
 * It exists because of where the two sit. `OutlineRail` is slotted into
 * `AppShell` by the `(app)` layout, while the messages live in `Chat` — a Client
 * Component inside `children`. The rail is a *sibling* of the thread, neither
 * its ancestor nor its descendant, so no prop can reach from one to the other.
 * `AppShell` is the nearest component above both, and it is already a Client
 * Component, which is what makes it the place this state can live.
 *
 * That is also what satisfies "derived from the already-loaded thread, no extra
 * query": the entries are the same `useChat` array the thread is rendering, not
 * a second read of the same rows.
 *
 * Traffic goes both ways. `Chat` writes `entries` and `activeId` and supplies
 * `jumpTo`; the rail reads the first two and calls the third. Scrolling stays
 * with `Chat` because `Chat` owns the scroll container — the rail knows which
 * message it wants and nothing about how to get there.
 */
export type OutlineState = {
  entries: readonly OutlineEntry[]
  /** The exchange currently being read, or null above the first one. */
  activeId: string | null
  /** Scrolls the thread to a message and flashes it. A no-op when unpublished. */
  jumpTo: (messageId: string) => void
}

/**
 * Kept in its own context, apart from the value it writes.
 *
 * `Chat` needs `publish` but must never subscribe to `entries` — reading the
 * state it is the source of would re-render it on its own write, one step short
 * of a loop. Two contexts make that structural rather than a rule to remember.
 */
export type OutlinePublisher = {
  publish: (outline: OutlineState) => void
}

/**
 * What a route with no thread looks like.
 *
 * Frozen and module-level so it is referentially stable — a fresh object here
 * would be a new context value on every render of every consumer.
 */
export const EMPTY_OUTLINE: OutlineState = Object.freeze({
  entries: Object.freeze([]) as readonly OutlineEntry[],
  activeId: null,
  jumpTo: () => {},
})

export const OutlineContext = createContext<OutlineState>(EMPTY_OUTLINE)

/** Set by `Chat`, and by nothing else. Absent outside the shell. */
export const OutlinePublisherContext = createContext<OutlinePublisher | null>(null)

/**
 * The current outline.
 *
 * Unlike `useShell()` this does not throw without a provider. The rail is only
 * ever rendered inside the shell, but nothing *publishes* on `/settings` or
 * `/prompts` — those routes have no thread — and an empty outline is the correct
 * answer there rather than an error.
 */
export function useOutline(): OutlineState {
  return useContext(OutlineContext)
}

/**
 * The publishing half, for the one component that owns a thread.
 *
 * Returns null outside the shell so `Chat` can be rendered in isolation without
 * a provider standing over it.
 */
export function useOutlinePublisher(): OutlinePublisher | null {
  return useContext(OutlinePublisherContext)
}
