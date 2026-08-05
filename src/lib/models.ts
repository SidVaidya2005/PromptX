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
 * One catalog entry, or null when this provider does not serve that id.
 *
 * `resolveModel()` treats null as a refusal, which is what makes this catalog an
 * enforcement boundary rather than a list the picker happens to read. The check
 * lives there and only there — validating membership in the zod schema as well
 * would put one rule in two files with nothing keeping them in step.
 */
export function findModel(provider: Provider, modelId: string): Model | null {
  return MODEL_CATALOG[provider].find((model) => model.id === modelId) ?? null
}
