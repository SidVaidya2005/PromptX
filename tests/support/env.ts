import { hostedEnvState } from './hosted-env'

/**
 * A value read at module scope by every suite that talks to the real Supabase
 * project.
 *
 * Read at module scope, never inside a hook: createClient() throws its own
 * opaque "supabaseKey is required" the moment it is called with a blank key,
 * which would land before any hook ran and tell the reader nothing.
 *
 * That module-scope read is also why a clean checkout used to fail rather than
 * skip: `describeHosted` skips the suites, but the file is still imported and
 * this function still runs. So when the hosted environment is **entirely**
 * absent it hands back a placeholder instead of throwing. Nothing uses it —
 * Vitest runs no hook and no test in a file whose every suite is skipped
 * (measured, not assumed) — it exists only so `createClient` can be constructed
 * without complaint. It is a valid URL because the same placeholder serves both
 * the URL variables and the key ones.
 *
 * A *partial* environment never reaches here: `global-setup.ts` aborts the run
 * before any suite loads, because skipping there would report green while
 * proving nothing. The throw below therefore covers the remaining case — a
 * variable outside the hosted three that a suite needs and cannot find.
 */

const SKIPPED_PLACEHOLDER = 'https://hosted-suites-skipped.invalid'

export function requiredEnv(name: string): string {
  const value = process.env[name]
  if (value) return value

  if (hostedEnvState(process.env) === 'absent') return SKIPPED_PLACEHOLDER

  throw new Error(
    `${name} is missing. These suites talk to the real Supabase project and ` +
      'need NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ' +
      'and SUPABASE_SECRET_KEY in .env.local. SUPABASE_SECRET_KEY comes from ' +
      'Dashboard → Project Settings → API Keys and is not retrievable any ' +
      'other way.',
  )
}
