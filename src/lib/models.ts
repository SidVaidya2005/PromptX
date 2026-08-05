/**
 * The models PromptX will talk to, and what each one can accept.
 *
 * A fixed curated list, not a live fetch. Provider catalogs are paginated,
 * inconsistently shaped, and full of embedding, image, and TTS models that have
 * no place in a chat picker — and a dynamic catalog is explicitly out of scope
 * for v1 (`library-docs.md` → OpenRouter).
 *
 * This file is importable from Client Components. It holds public data only and
 * must never reach into `src/server/` — an ESLint zone enforces that.
 *
 * ── How these entries were established ───────────────────────────────────────
 *
 * Not from memory. Model ids move faster than any training set, so every id,
 * display name, context window, and capability flag below was read from a live
 * source and then PROVEN BY GENERATING, which are two different things:
 *
 *   - Listed  — Google's `v1beta/models` and OpenRouter's public `/api/v1/models`.
 *   - Proven  — a real one-token completion against the id.
 *
 * The gap between those two is the entire reason for the second step. Google
 * still lists `gemini-2.5-flash`, which answers a real request with "no longer
 * available to new users" (F08). Listing is not availability, so an id that has
 * not generated does not belong here.
 */

import { SHARED_MODEL_ID } from '@/lib/constants'

import type { Provider } from '@/types/domain'

export type Model = {
  /** Sent to the provider verbatim. For OpenRouter this is `vendor/model`. */
  id: string
  /** Shown in the picker. Inter, not DM Mono — the `id` is the technical string. */
  label: string
  /** Input tokens the model accepts. Display only until a feature needs to budget. */
  contextWindow: number
  /** Read from feature 30. Nothing consumes these yet. */
  supportsImages: boolean
  supportsPdf: boolean
}

/**
 * Keyed by the Postgres enum, so adding a provider without a catalog is a type
 * error rather than an empty picker group nobody notices.
 *
 * `openai` and `anthropic` are deliberately empty. No key for either was
 * available when this shipped, so their ids could be neither listed from their
 * own endpoints nor proven by generating — and an unverified id is exactly what
 * the note above exists to keep out. The consequence is real and worth stating:
 * because `resolveModel()` refuses anything absent from this catalog, a user who
 * adds a valid OpenAI or Anthropic key still cannot send a message. That is why
 * the refusal names the empty catalog rather than blaming the model id.
 *
 * Both providers reach a user through `openrouter` in the meantime, which is
 * partly why the OpenRouter entries below span three vendors instead of
 * showcasing OpenRouter's own breadth.
 */
export const MODEL_CATALOG: Record<Provider, readonly Model[]> = {
  openai: [],

  anthropic: [],

  google: [
    {
      // Also SHARED_MODEL_ID. Referenced rather than repeated as a literal, so
      // the shared key can never point at a model this catalog would refuse.
      id: SHARED_MODEL_ID,
      label: 'Gemini 3.6 Flash',
      contextWindow: 1_048_576,
      supportsImages: true,
      supportsPdf: true,
    },
    {
      id: 'gemini-3.5-flash',
      label: 'Gemini 3.5 Flash',
      contextWindow: 1_048_576,
      supportsImages: true,
      supportsPdf: true,
    },
    {
      id: 'gemini-3.5-flash-lite',
      label: 'Gemini 3.5 Flash Lite',
      contextWindow: 1_048_576,
      supportsImages: true,
      supportsPdf: true,
    },
    // No Pro tier. `gemini-3.1-pro-preview` is the only one Google lists, and it
    // answered the verification call with "you exceeded your current quota" —
    // it is not on the free tier the shared key sits on. Unproven, so absent.
  ],

  openrouter: [
    {
      id: 'anthropic/claude-opus-5',
      label: 'Claude Opus 5',
      contextWindow: 1_000_000,
      supportsImages: true,
      supportsPdf: true,
    },
    {
      id: 'anthropic/claude-sonnet-5',
      label: 'Claude Sonnet 5',
      contextWindow: 1_000_000,
      supportsImages: true,
      supportsPdf: true,
    },
    {
      id: 'openai/gpt-5.6-luna',
      label: 'GPT-5.6 Luna',
      contextWindow: 1_050_000,
      supportsImages: true,
      supportsPdf: true,
    },
    {
      id: 'google/gemini-3.6-flash',
      label: 'Gemini 3.6 Flash',
      contextWindow: 1_048_576,
      supportsImages: true,
      supportsPdf: true,
    },
  ],
}

/**
 * The order providers appear in the picker.
 *
 * Explicit rather than `Object.keys(MODEL_CATALOG)`, which is object-literal
 * order — correct today and silently reorderable by anyone tidying the catalog.
 * A test pins this against the catalog's own keys, so a provider added to one
 * and not the other cannot render as a group with no heading. (F15)
 */
export const PROVIDER_ORDER: readonly Provider[] = [
  'google',
  'openrouter',
  'openai',
  'anthropic',
] as const

/**
 * One catalog entry, or null when this provider does not serve that id.
 *
 * Null is a refusal, which is what makes this catalog an enforcement boundary
 * rather than a list the picker happens to read. Two callers check it —
 * `resolveModel()` before a send, and `PATCH /api/conversations/[id]` before
 * storing a model on a conversation — because a model id can enter the system
 * through either, and a conversation left holding an id the sender will refuse
 * is a thread that cannot be replied to until someone changes the picker back.
 * That is two call sites of one rule, not the same rule written twice: the
 * definition lives here, and validating membership in a zod schema as well is
 * what would put it in two places with nothing keeping them in step.
 */
export function findModel(provider: Provider, modelId: string): Model | null {
  return MODEL_CATALOG[provider].find((model) => model.id === modelId) ?? null
}

/**
 * Whether the shared key serves this model.
 *
 * The one definition of what a user without any key of their own can reach, and
 * it has two callers that must not drift: `resolveModel()` refuses everything
 * else on the server, and the picker greys out everything else in the browser.
 * Written as one function precisely because those two answers disagreeing is
 * invisible — the picker would offer a model that every send then refuses, or
 * hide one that would have worked. (F15)
 */
export function isSharedModel(provider: Provider, modelId: string): boolean {
  return provider === 'google' && modelId === SHARED_MODEL_ID
}

/**
 * Whether this caller can actually send to this model right now.
 *
 * Their own key for the provider, or the shared fallback. Mirrors
 * `resolveModel()` branch for branch, through `isSharedModel` above.
 */
export function isModelAvailable(
  provider: Provider,
  modelId: string,
  configuredProviders: readonly Provider[],
): boolean {
  return configuredProviders.includes(provider) || isSharedModel(provider, modelId)
}

/**
 * Whether sending to this model would spend the shared allowance.
 *
 * True exactly when `resolveModel()` would return `usedSharedKey: true`, and it
 * is the inverse condition to `isModelAvailable`'s first term rather than a
 * restatement of it: a model can be available *because* the caller has a key,
 * in which case the shared quota has nothing to do with the request.
 *
 * Three surfaces read this and must agree — whether the quota meter is shown,
 * whether an exhausted allowance locks the composer, and whether the server
 * claims a slot. The first two are decided in the browser and the third in
 * Postgres, so a second spelling of the rule would show a meter to somebody it
 * does not apply to, or lock a composer over an allowance their request would
 * never touch. (F16)
 */
export function willUseSharedKey(
  provider: Provider,
  modelId: string,
  configuredProviders: readonly Provider[],
): boolean {
  return !configuredProviders.includes(provider) && isSharedModel(provider, modelId)
}

/**
 * A single string identifying one catalog entry, for a Radix radio group.
 *
 * A model id alone will not do. `Gemini 3.6 Flash` exists under both `google`
 * and `openrouter` — same label, different ids, different bills — so a picker
 * keyed on the id would light the wrong checkmark and, worse, would let a
 * selection resolve to the provider the user did not pick. Radix's
 * `DropdownMenuRadioGroup` carries one string per item, so the pair is encoded
 * into it. (F15)
 */
export function encodeModelKey(provider: Provider, modelId: string): string {
  return `${provider}:${modelId}`
}

/**
 * The provider and model a key names, or null if it names neither.
 *
 * Split on the FIRST separator only. A provider never contains `:` — it is a
 * Postgres enum — but a model id may: OpenRouter publishes variants like
 * `:free` and `:thinking`, and nothing stops one entering the catalog later. A
 * naive split would quietly truncate such an id to the part before the colon
 * and resolve to a model that was never chosen.
 *
 * Returns null rather than throwing for an unknown provider or an id absent
 * from the catalog, because the input is a string read back out of the DOM.
 */
export function decodeModelKey(key: string): { provider: Provider; modelId: string } | null {
  const separator = key.indexOf(':')
  if (separator === -1) return null

  const provider = key.slice(0, separator)
  const modelId = key.slice(separator + 1)

  if (!isProvider(provider)) return null
  if (!findModel(provider, modelId)) return null

  return { provider, modelId }
}

function isProvider(value: string): value is Provider {
  return (PROVIDER_ORDER as readonly string[]).includes(value)
}
