import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Reads `.env.local` into a plain object.
 *
 * Lives here rather than inside `vitest.config.ts` because two callers need the
 * same answer: the config, which injects these into `test.env`, and
 * `global-setup.ts`, which decides before any suite loads whether the hosted
 * tests can run. A second parser would be a second set of rules for the same
 * file, free to disagree about a quoted value or a trailing space.
 *
 * Hand-parsed rather than via vite's loadEnv: pnpm's strict linking does not
 * expose `vite` at the project root (it is only a transitive dependency of
 * Vitest), and adding it as a direct dependency to reach one helper fails the
 * Dependencies gate in code-standards.md. Splitting on the FIRST `=` matters —
 * ENCRYPTION_KEY is base64 and ends in padding.
 */
export function envLocal(): Record<string, string> {
  const path = fileURLToPath(new URL('../../.env.local', import.meta.url))
  if (!existsSync(path)) return {}

  const entries: Record<string, string> = {}

  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const separator = trimmed.indexOf('=')
    if (separator === -1) continue

    entries[trimmed.slice(0, separator).trim()] = trimmed
      .slice(separator + 1)
      .trim()
  }

  return entries
}
