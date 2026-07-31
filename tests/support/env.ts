/**
 * Shared by every suite that talks to the real Supabase project.
 *
 * Read at module scope, never inside a hook: createClient() throws its own
 * opaque "supabaseKey is required" the moment it is called with a blank key,
 * which would land before any hook ran and tell the reader nothing.
 */
export function requiredEnv(name: string): string {
  const value = process.env[name]

  if (!value) {
    throw new Error(
      `${name} is missing. These suites talk to the real Supabase project and ` +
        'need NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ' +
        'and SUPABASE_SECRET_KEY in .env.local. SUPABASE_SECRET_KEY comes from ' +
        'Dashboard → Project Settings → API Keys and is not retrievable any ' +
        'other way.',
    )
  }

  return value
}
