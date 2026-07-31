import { createClient } from '@supabase/supabase-js'
import { afterAll, describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import { requiredEnv } from '../support/env'

/**
 * The auth configuration lives in a dashboard, not in a migration. It produces
 * no diff, no review, and no history — so the only thing standing between it
 * and a silent change is this file.
 *
 * Three facts are pinned here, and each one guards a different mistake:
 *
 * 1. Google is enabled and GLOBAL signups are still allowed. Supabase's
 *    "Allow new users to sign up" is not email-specific — turning it off blocks
 *    OAuth sign-ups too, so no new visitor could ever create an account. That
 *    is the mistake feature 03's closing note would have led to.
 * 2. A self-service email signup yields NO session. The email provider stays
 *    enabled, which leaves /auth/v1/signup reachable; what makes that bounded
 *    rather than dangerous is that a session is only issued after the address
 *    is confirmed. If autoconfirm were ever switched on, this test goes red and
 *    that hole becomes a real JWT that can spend shared Gemini quota.
 * 3. Admin-created users can still sign in with a password. This is how
 *    tests/rls/isolation.test.ts mints real sessions. "Fixing" fact 2 by
 *    disabling the email provider outright would take all 16 of those tests
 *    down for a reason that looks nothing like the cause.
 */

const SUPABASE_URL = requiredEnv('NEXT_PUBLIC_SUPABASE_URL')
const PUBLISHABLE_KEY = requiredEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY')
const SECRET_KEY = requiredEnv('SUPABASE_SECRET_KEY')

const admin = createClient<Database>(SUPABASE_URL, SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const anonymous = createClient<Database>(SUPABASE_URL, PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

/** Every user this suite brings into existence, cleaned up at the end. */
const createdUserIds: string[] = []

afterAll(async () => {
  for (const id of createdUserIds) {
    await admin.auth.admin.deleteUser(id)
  }
})

describe('the auth configuration', () => {
  it('offers Google sign-in and still lets new accounts be created', async () => {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/settings`, {
      headers: { apikey: PUBLISHABLE_KEY },
    })

    expect(response.ok).toBe(true)

    const settings = (await response.json()) as {
      external: Record<string, boolean>
      disable_signup: boolean
      mailer_autoconfirm: boolean
    }

    expect(settings.external.google).toBe(true)

    // Global, despite the dashboard copy sitting beside the email provider.
    // True here would mean no new Google user could ever sign up.
    expect(settings.disable_signup).toBe(false)

    // Kept enabled on purpose: signInWithPassword against admin-created users
    // is how every data-layer suite gets a real JWT.
    expect(settings.external.email).toBe(true)

    // The reason the open signup endpoint cannot mint a usable session.
    expect(settings.mailer_autoconfirm).toBe(false)
  })

  it('issues no session for a self-service email signup', async () => {
    const { data } = await anonymous.auth.signUp({
      email: `signup-probe-${crypto.randomUUID()}@promptx.test`,
      password: crypto.randomUUID(),
    })

    if (data.user?.id) createdUserIds.push(data.user.id)

    // The assertion that matters, and it holds however the request failed —
    // unconfirmed address, refused send, or rate limit. What must never happen
    // is a stranger walking away with a token.
    expect(data.session).toBeNull()
    expect(data.user?.email_confirmed_at ?? null).toBeNull()
  })

  it('still signs in a user the admin API created', async () => {
    const email = `admin-probe-${crypto.randomUUID()}@promptx.test`
    const password = crypto.randomUUID()

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })

    expect(createError).toBeNull()
    if (created?.user?.id) createdUserIds.push(created.user.id)

    const { data: signedIn, error: signInError } = await anonymous.auth.signInWithPassword(
      { email, password },
    )

    expect(signInError).toBeNull()
    expect(signedIn.session?.access_token).toBeTruthy()

    await anonymous.auth.signOut()
  })
})
