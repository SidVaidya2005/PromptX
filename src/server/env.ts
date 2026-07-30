import 'server-only'

import { z } from 'zod'

/**
 * The secret environment, validated once at module load.
 *
 * This is the ONLY module in the codebase that reads a secret from
 * process.env. Public, browser-safe configuration lives in src/lib/constants.ts,
 * which is importable from Client Components and therefore must never see any
 * of these values.
 *
 * Parsing at load time means the process fails to boot on a missing or
 * malformed variable, rather than failing at the first request that happens to
 * need one.
 */
const serverEnvSchema = z.object({
  /** Assumes service_role and bypasses RLS entirely. Format `sb_secret_…`. */
  SUPABASE_SECRET_KEY: z.string().min(1),

  /** 32 bytes, base64-encoded. Generate with `openssl rand -base64 32`. */
  ENCRYPTION_KEY: z.string().refine(
    // Buffer.from is deliberately allowed past the "queries live in
    // src/server/data/" lint rule, which excludes Buffer/Array/Object receivers.
    (value) => Buffer.from(value, 'base64').length === 32,
    { message: 'ENCRYPTION_KEY must decode to exactly 32 bytes' },
  ),

  /** The billed key behind the shared Gemini fallback. */
  SHARED_GEMINI_API_KEY: z.string().min(1),
})

export type ServerEnv = z.infer<typeof serverEnvSchema>

/** Throws at startup, not at the first request that needs a variable. */
export const serverEnv: ServerEnv = serverEnvSchema.parse(process.env)
