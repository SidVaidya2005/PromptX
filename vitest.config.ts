import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

/**
 * The RLS suite talks to the real Supabase project, so it needs the values in
 * .env.local — which Vitest does not read on its own.
 *
 * Hand-parsed rather than via vite's loadEnv: pnpm's strict linking does not
 * expose `vite` at the project root (it is only a transitive dependency of
 * Vitest), and adding it as a direct dependency to reach one helper fails the
 * Dependencies gate in code-standards.md. Splitting on the FIRST `=` matters —
 * ENCRYPTION_KEY is base64 and ends in padding.
 */
function envLocal(): Record<string, string> {
  const path = fileURLToPath(new URL('./.env.local', import.meta.url))
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

export default defineConfig({
  resolve: {
    alias: {
      // Three lines beat the vite-tsconfig-paths dependency, per the
      // Dependencies gate in code-standards.md.
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // `server-only` resolves to a module that throws unless the bundler sets
      // the "react-server" export condition, which Vitest does not. Every
      // module under src/server/ imports it, so without this alias the entire
      // server test suite fails at import time for a reason unrelated to what
      // is being tested.
      'server-only': fileURLToPath(
        new URL('./tests/stubs/server-only.ts', import.meta.url),
      ),
    },
  },
  test: {
    // Not optional: the vault needs real node:crypto, and jsdom would shim it.
    environment: 'node',
    // Tests mirror src/server/ from tests/, per architecture.md's folder structure.
    include: ['tests/**/*.test.ts'],
    // Reset spies and stubbed env vars after every test, so a leaked
    // ENCRYPTION_KEY cannot make the next test pass for the wrong reason.
    restoreMocks: true,
    unstubEnvs: true,
    env: envLocal(),
    // The RLS suite is a network round trip per assertion against a project in
    // Singapore. The default 5s is not enough from anywhere else.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
