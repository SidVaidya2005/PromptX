import { describe } from 'vitest'

import { hasSupabaseEnv } from './hosted-env'

/**
 * `describe` for a suite that talks to the hosted project.
 *
 * Split from `hosted-env.ts` for one mechanical reason: `vitest.config.ts` needs
 * `PLACEHOLDER_PUBLIC_ENV` from that module, and the config is loaded through
 * `require()` — so anything it imports, however indirectly, must not pull in
 * `vitest` itself. The rule lives in one file, the `describe` wrapper in the
 * other.
 */
export const describeHosted = describe.skipIf(!hasSupabaseEnv)
