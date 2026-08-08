import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

// The hosted suites need the values in .env.local, which Vitest does not read on
// its own. Shared with tests/support/global-setup.ts, which has to reach the same
// verdict about the same file before any suite loads.
import { envLocal } from './tests/support/env-file'
import { PLACEHOLDER_ENV } from './tests/support/hosted-env'

/**
 * `src/lib/constants.ts` validates the public environment at import — deliberate
 * in production, and fatal for `tests/lib/*` on a machine with no `.env.local`,
 * which has nothing to do with Supabase. Placeholders fill only what neither the
 * file nor the real environment supplies, so a configured machine and CI both
 * keep their own values.
 */
const fromFile = envLocal()

const placeholders = Object.fromEntries(
  Object.entries(PLACEHOLDER_ENV).filter(
    ([name]) => !fromFile[name] && !process.env[name],
  ),
)

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
    // Decides once, before any suite loads, whether the hosted tests can run:
    // banner on a clean checkout, hard failure on a partial environment.
    globalSetup: ['./tests/support/global-setup.ts'],
    // Blocks a real call to a paid provider host. See the file for why this is a
    // mechanism rather than a convention.
    setupFiles: ['./tests/support/no-paid-providers.ts'],
    // Reset spies and stubbed env vars after every test, so a leaked
    // ENCRYPTION_KEY cannot make the next test pass for the wrong reason.
    restoreMocks: true,
    unstubEnvs: true,
    env: { ...placeholders, ...fromFile },
    /**
     * Scoped to src/server/, which is what feature 35 is accountable for — the
     * components have no automated coverage at all until Playwright arrives at
     * F36, so including them would report a number about nothing.
     *
     * No thresholds, deliberately. This is a discovery instrument for finding
     * untested branches, not a gate: a percentage bar over a suite that pays a
     * network round trip per test rewards tests written to move the number, and
     * this project has recorded that failure three times already under other
     * names. The gate is the mutation pass — break the thing a test protects and
     * confirm it notices.
     */
    coverage: {
      provider: 'v8',
      include: ['src/server/**'],
      reporter: ['text', 'html'],
    },
    // The RLS suite is a network round trip per assertion against a project in
    // Singapore. The default 5s is not enough from anywhere else.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
