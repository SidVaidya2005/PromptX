import { defineConfig, devices } from '@playwright/test'

import { envLocal } from './tests/support/env-file'
import { preflight } from './e2e/support/preflight'

/**
 * Four specs, and no more. `code-standards.md` fixes the list: sign in, send a
 * message and receive a stream, add a key and see only its last four, and
 * exhaust the shared allowance to meet the wall. Anything a unit test can prove
 * belongs in `tests/`, which now holds 619 of them.
 *
 * **Against a production build, not `next dev`.** Two reasons, both already paid
 * for once by this project: `NEXT_PUBLIC_*` are inlined at BUILD time, so a dev
 * server can disagree with production about values that were never rebuilt; and
 * `constraints.md` records the dev server reporting different `Cache-Control`
 * headers than production, which sent a previous feature looking for a bug that
 * did not exist. A suite whose whole purpose is to be the safety net before
 * deployment must not run against a different application than the one deployed.
 *
 * `.env.local` is loaded here for the same reason `vitest.config.ts` loads it:
 * the specs talk to the hosted Supabase project, and there is no local stack.
 */

const fromFile = envLocal()

for (const [name, value] of Object.entries(fromFile)) {
  process.env[name] ??= value
}

/**
 * Checked at CONFIG LOAD, which is the earliest point that exists.
 *
 * It started life in `globalSetup` and that was measured to be too late:
 * Playwright starts `webServer` first, so an unconfigured checkout got a Next
 * build failure about a missing NEXT_PUBLIC variable — thirty seconds of build
 * output ending in a stack trace — instead of the one sentence naming what to
 * do. The exit code was already correct; the message was the point.
 */
preflight()

const PORT = 3000
const BASE_URL = `http://localhost:${PORT}`

export default defineConfig({
  // Scoped so Playwright and Vitest cannot collect each other's files: Vitest
  // matches tests/**/*.test.ts, this matches e2e/**/*.spec.ts.
  testDir: './e2e',
  testMatch: '**/*.spec.ts',

  // Each spec file owns its own Supabase user and tears it down, so files are
  // safe to run in parallel — the isolation F35 learned to insist on after two
  // suites collided over shared global state.
  fullyParallel: true,

  // A retry hides a flaky test rather than reporting it, and this suite is small
  // enough that a failure should be looked at rather than re-rolled. CI gets one
  // retry only so a genuinely transient network fault does not block a run.
  retries: process.env.CI ? 1 : 0,
  forbidOnly: Boolean(process.env.CI),

  reporter: process.env.CI ? [['github'], ['list']] : [['list']],

  use: {
    baseURL: BASE_URL,
    // Kept on first retry rather than always: a trace per run is large, and the
    // one that matters is the one attached to a failure.
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: {
    // The same command Render runs. `next start` binds PORT itself.
    command: 'pnpm build && pnpm start',
    url: BASE_URL,
    // Locally the build is paid once and the server reused; CI always builds,
    // so a stale server can never answer for a change it does not contain.
    reuseExistingServer: !process.env.CI,
    timeout: 5 * 60 * 1000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
