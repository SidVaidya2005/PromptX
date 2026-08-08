import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'

import { HOSTED_ENV_VARS, missingHostedEnvVars } from '../../tests/support/hosted-env'

/**
 * What `pnpm test:e2e` needs before it can mean anything, checked once and
 * reported as a sentence rather than as a stack trace.
 *
 * **This fails; it does not skip** — and the difference from `pnpm test` is
 * deliberate rather than inconsistent. F35 made the unit suite skip its hosted
 * files on a bare checkout because the remainder is a genuinely useful offline
 * suite: 299 tests still run and still mean something. Here every spec needs the
 * hosted project and a browser, so a skipping run would execute nothing at all
 * and still print success — the exact shape F35's partial-config guard exists to
 * refuse.
 *
 * Called from `playwright.config.ts` at module scope, not from `globalSetup` —
 * which Playwright runs AFTER starting the `webServer`. Measured: from
 * `globalSetup` an unconfigured checkout got thirty seconds of Next build output
 * ending in a stack trace about a missing `NEXT_PUBLIC_` variable. The exit code
 * was right either way; the sentence is the point.
 */

function missingBrowsers(): boolean {
  const root =
    process.env.PLAYWRIGHT_BROWSERS_PATH ||
    path.join(
      process.env.HOME ?? '',
      process.platform === 'darwin' ? 'Library/Caches/ms-playwright' : '.cache/ms-playwright',
    )

  if (!existsSync(root)) return true

  return !readdirSync(root).some((entry) => entry.startsWith('chromium'))
}

export function preflight(): void {
  const problems: string[] = []

  const missingEnv = missingHostedEnvVars(process.env)
  if (missingEnv.length > 0) {
    problems.push(
      `  • Missing ${missingEnv.join(', ')} in .env.local.\n` +
        `    Every spec signs in against the hosted Supabase project; there is no\n` +
        `    local stack. All of ${HOSTED_ENV_VARS.join(', ')} are required.`,
    )
  }

  if (missingBrowsers()) {
    problems.push(
      '  • No Chromium build found.\n' +
        '    Run `pnpm exec playwright install chromium` (~95 MB). It is not\n' +
        '    installed for you, because a command that says it runs tests should\n' +
        '    not quietly download a browser.',
    )
  }

  if (problems.length === 0) return

  throw new Error(
    `\ne2e cannot run:\n\n${problems.join('\n\n')}\n\n` +
      'These specs are not skipped when unconfigured. A suite that runs none of\n' +
      'its four tests and reports success is worse than one that says why it\n' +
      'could not start.\n',
  )
}
