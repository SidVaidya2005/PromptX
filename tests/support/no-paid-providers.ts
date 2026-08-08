/**
 * "No test may make a real call to a paid provider API" — as a mechanism rather
 * than as a rule everyone remembers.
 *
 * code-standards.md has said it since F01 and it has held, but only because each
 * suite stubbed `fetch` for itself. A rule kept by habit fails the first time
 * somebody adds a test that forgets, and the symptom is a charge on a real
 * account rather than a red test. This throws instead.
 *
 * The four hosts are exactly the ones `src/server/keys.ts` probes and the four
 * provider SDKs generate against. Supabase, Storage and the Edge Function are
 * deliberately untouched: the hosted suites are supposed to reach those, and a
 * guard that blocked them would have to be disabled to get any work done, which
 * is how a guard stops being one.
 *
 * Installed once at module scope rather than in a `beforeEach`. Suites that stub
 * `fetch` themselves — keys.test.ts does, for every case — replace this wrapper
 * for the duration and restore it with `unstubAllGlobals`, so the mock intercepts
 * and nothing reaches the network either way.
 */

const PAID_PROVIDER_HOSTS = [
  'api.openai.com',
  'api.anthropic.com',
  'generativelanguage.googleapis.com',
  'openrouter.ai',
]

function hostOf(input: RequestInfo | URL): string {
  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url

  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

const realFetch = globalThis.fetch

globalThis.fetch = async function guardedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const host = hostOf(input)

  if (PAID_PROVIDER_HOSTS.some((paid) => host === paid || host.endsWith(`.${paid}`))) {
    throw new Error(
      `Blocked a real request to ${host}. No test in this project may spend ` +
        'money — stub fetch, or mock at the resolveModel() boundary as ' +
        'tests/server/providers.test.ts does.',
    )
  }

  return realFetch(input, init)
}
