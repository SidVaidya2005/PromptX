import { redirect } from 'next/navigation'

import { getUser } from '@/server/auth'

import { FeatureGrid } from '@/components/landing/FeatureGrid'
import { HowItWorks } from '@/components/landing/HowItWorks'
import { LandingFooter } from '@/components/landing/LandingFooter'
import { LandingHero } from '@/components/landing/LandingHero'
import { LandingNav } from '@/components/landing/LandingNav'

type LandingPageProps = {
  // A Promise in Next.js 16 — the synchronous form 15 allowed is gone, and a
  // missing await now breaks at runtime while compiling cleanly.
  searchParams: Promise<{ error?: string }>
}

export default async function LandingPage({ searchParams }: LandingPageProps) {
  const { error } = await searchParams

  // Signed-in visitors belong in the workspace. getUser() makes no network call
  // when there is no session cookie, so the common case — a stranger arriving
  // on a cold instance — pays nothing for this check.
  if (await getUser()) redirect('/chat')

  return (
    <>
      <LandingNav />

      {error ? (
        <div className="mx-auto max-w-300 px-xl pt-xl">
          <p
            role="alert"
            className="rounded-md border border-danger bg-canvas-soft px-lg py-md text-body-sm text-danger"
          >
            Sign-in did not complete. Please try again.
          </p>
        </div>
      ) : null}

      <main>
        <LandingHero />
        <FeatureGrid />
        <HowItWorks />
      </main>

      <LandingFooter />
    </>
  )
}
