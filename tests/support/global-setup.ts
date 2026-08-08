import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { envLocal } from './env-file'
import {
  HOSTED_ENV_VARS,
  hostedEnvState,
  missingHostedEnvVars,
} from './hosted-env'

/**
 * Runs once, before any suite loads, and decides what "green" is allowed to mean
 * for this run.
 *
 * A clean checkout skips the hosted suites and says so loudly — the count is
 * computed by reading which files actually use `describeHosted`, not from a
 * number kept by hand that would drift the first time a suite was added. A
 * partial environment aborts the run instead, because a silent skip there is a
 * green suite that proved nothing.
 *
 * `process.env` alone is not enough here: `test.env` is injected into the test
 * environments, not into global setup, so `.env.local` is read directly.
 */

const TESTS = fileURLToPath(new URL('..', import.meta.url))

function testFilesUnder(dir: string): string[] {
  const files: string[] = []

  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)

    if (statSync(full).isDirectory()) {
      files.push(...testFilesUnder(full))
      continue
    }

    if (entry.endsWith('.test.ts')) files.push(full)
  }

  return files
}

function hostedSuites(): string[] {
  return testFilesUnder(TESTS)
    .filter((file) => readFileSync(file, 'utf8').includes('describeHosted'))
    .map((file) => path.relative(TESTS, file))
    .sort()
}

export default function setup(): void {
  const env = { ...envLocal(), ...process.env }
  const state = hostedEnvState(env)

  if (state === 'partial') {
    const missing = missingHostedEnvVars(env)

    throw new Error(
      `.env.local is present but incomplete — missing ${missing.join(', ')}.\n` +
        'Refusing to run: skipping the hosted suites here would report green ' +
        'while proving nothing. Supply every one of ' +
        `${HOSTED_ENV_VARS.join(', ')}, or remove them all to run the pure ` +
        'suites alone. SUPABASE_SECRET_KEY comes from Dashboard → Project ' +
        'Settings → API Keys and is not retrievable any other way.',
    )
  }

  if (state === 'absent') {
    const suites = hostedSuites()

    console.warn(
      `\n  ${suites.length} suites SKIPPED — no Supabase credentials in .env.local.\n` +
        '  These talk to the hosted project; there is no local stack to fall back on.\n' +
        `${suites.map((suite) => `    - ${suite}`).join('\n')}\n` +
        `  Set ${HOSTED_ENV_VARS.join(', ')} to run them.\n`,
    )
  }
}
