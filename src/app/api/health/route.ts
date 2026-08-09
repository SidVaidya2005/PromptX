import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

/**
 * Render's liveness probe target. (F38)
 *
 * It returns `{ ok: true }` and nothing else — no session lookup, no database
 * query, no version string, no environment detail. Three reasons, each of which
 * has bitten a real deployment somewhere:
 *
 * - A health check that reads the database turns a slow query into a restart
 *   loop. Render marks the instance unhealthy, restarts it, and the new process
 *   meets the same slow query. The outage is then caused by the monitoring.
 * - A health check that leaks build metadata is free reconnaissance.
 * - A health check that can fail for a reason unrelated to the process being
 *   alive is not measuring what it claims to measure.
 *
 * `force-dynamic` is load-bearing rather than decorative. A route handler that
 * reads no dynamic API gets statically optimised, and the probe would then be
 * served from a build-time artifact — still a 200, still only reachable if the
 * process is up, but measuring a file rather than the thing it claims to.
 *
 * This route is excluded from `src/proxy.ts`'s matcher. Today that costs
 * nothing measurable: with no session cookie, auth-js short-circuits to
 * AuthSessionMissingError locally and never leaves the process. The exclusion
 * is what makes "no session lookup" a property of the route rather than an
 * accident of which headers the prober happens to send.
 */
export const dynamic = 'force-dynamic'

export function GET() {
  return NextResponse.json({ ok: true })
}
