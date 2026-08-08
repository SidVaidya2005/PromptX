/**
 * The gate between the suites that need the real Supabase project and the ones
 * that do not.
 *
 * There is no local stack (F02), so every data-module, RLS, quota and storage
 * test talks to the hosted project and needs three variables from `.env.local`.
 * Before F35 that dependency was expressed by `requiredEnv()` throwing at module
 * scope, which meant a clone without `.env.local` did not fail a test — it
 * failed to *load*, thirteen files at once, before a single assertion ran.
 *
 * `describeHosted` skips those suites instead, so `pnpm test` is green on a
 * clean checkout. What keeps that from being a lie is `global-setup.ts`, which
 * prints the skipped count and refuses to run at all on a PARTIAL environment —
 * see `hostedEnvState` below.
 */

export const HOSTED_ENV_VARS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SECRET_KEY',
] as const

/**
 * Stand-in values injected by `vitest.config.ts` when nothing else supplies them.
 *
 * They exist because both environment modules validate at **import**, by design:
 * `src/lib/constants.ts` for the public variables and `src/server/env.ts` for the
 * secrets, so that the application fails to boot on a missing variable rather
 * than at the first request that needs it. The consequence for the tests is that
 * a clean checkout could not even load `tests/lib/*`, which has nothing to do
 * with Supabase, nor any file importing `@/server/supabase` at module scope.
 * Placeholders satisfy the import; the production checks are untouched.
 *
 * Every value here is obviously fake and reaches nothing — the suites that would
 * use credentials are skipped in the same run. `ENCRYPTION_KEY` still has to
 * decode to 32 bytes, because `env.ts` proves that at boot and would otherwise
 * refuse the placeholder as loudly as it refuses a real mistake.
 *
 * Two of these are also hosted variables, so injecting them would otherwise read
 * as a half-configured environment and abort the run. `hostedEnvState` therefore
 * treats a value equal to its placeholder as absent — which is what keeps the
 * `partial` guard pointed at a genuinely half-configured machine rather than at
 * this file's own scaffolding.
 */
export const PLACEHOLDER_ENV: Record<string, string> = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://hosted-suites-skipped.invalid',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_hosted_suites_skipped',
  NEXT_PUBLIC_SITE_URL: 'https://hosted-suites-skipped.invalid',
  SUPABASE_SECRET_KEY: 'sb_secret_hosted_suites_skipped',
  ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  SHARED_GEMINI_API_KEY: 'hosted-suites-skipped',
}

export type HostedEnvState = 'complete' | 'absent' | 'partial'

/** A placeholder is scaffolding, not configuration, and does not count as set. */
function isConfigured(
  name: string,
  env: Record<string, string | undefined>,
): boolean {
  const value = env[name]
  return Boolean(value) && value !== PLACEHOLDER_ENV[name]
}

/**
 * Three states, not two, and the third is the whole point.
 *
 * `absent` is a clean checkout and skipping is right. `partial` is a machine
 * that *meant* to run these — one variable renamed, one value cleared — and
 * skipping there would turn several hundred assertions into a green no-op with
 * nothing on screen to say so. That is the same shape as a guard with nothing to
 * refuse (F28) and a flag pair no test could tell apart (F30): it does not fail,
 * it stops meaning anything. So `partial` is an error.
 */
export function hostedEnvState(
  env: Record<string, string | undefined>,
): HostedEnvState {
  const present = HOSTED_ENV_VARS.filter((name) => isConfigured(name, env))

  if (present.length === HOSTED_ENV_VARS.length) return 'complete'
  if (present.length === 0) return 'absent'
  return 'partial'
}

export function missingHostedEnvVars(
  env: Record<string, string | undefined>,
): string[] {
  return HOSTED_ENV_VARS.filter((name) => !isConfigured(name, env))
}

export const hasSupabaseEnv = hostedEnvState(process.env) === 'complete'
