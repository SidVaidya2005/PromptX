import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

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
  },
})
