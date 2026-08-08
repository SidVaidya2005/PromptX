import { readdirSync } from 'node:fs'
import path from 'node:path'

/**
 * Every route the audit sweeps, and a way to notice when that list goes stale.
 *
 * A route added later is invisible to a sweep that iterates a hand-written list
 * — the audit would stay green while covering less of the application, which is
 * the failure this project keeps naming: a guard that cannot fire. So the list
 * is declared here and **checked against the filesystem** by the spec. Adding a
 * `page.tsx` without adding it here turns the audit red, and the fix is one line.
 */

export type AuditRoute = {
  /** The path to visit. Dynamic segments are filled from a seeded fixture. */
  readonly url: string
  /** The `page.tsx` this corresponds to, relative to `src/app`. */
  readonly source: string
  readonly signedIn: boolean
  /** Filled in by the spec for routes with a dynamic segment. */
  readonly dynamic?: 'conversation' | 'share'
}

export const AUDIT_ROUTES: readonly AuditRoute[] = [
  { url: '/', source: 'page.tsx', signedIn: false },
  { url: '/chat', source: '(app)/chat/page.tsx', signedIn: true },
  {
    url: '/chat/:id',
    source: '(app)/chat/[id]/page.tsx',
    signedIn: true,
    dynamic: 'conversation',
  },
  { url: '/compare', source: '(app)/compare/page.tsx', signedIn: true },
  { url: '/prompts', source: '(app)/prompts/page.tsx', signedIn: true },
  { url: '/search', source: '(app)/search/page.tsx', signedIn: true },
  { url: '/settings/keys', source: '(app)/settings/keys/page.tsx', signedIn: true },
  { url: '/settings/account', source: '(app)/settings/account/page.tsx', signedIn: true },
  {
    url: '/share/:slug',
    source: 'share/[slug]/page.tsx',
    signedIn: false,
    dynamic: 'share',
  },
]

/** Every `page.tsx` under `src/app`, relative to it. */
export function pageFilesOnDisk(): string[] {
  const root = path.join(process.cwd(), 'src', 'app')
  const found: string[] = []

  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        walk(full)
        continue
      }

      if (entry.name === 'page.tsx') found.push(path.relative(root, full))
    }
  }

  walk(root)
  return found.sort()
}
