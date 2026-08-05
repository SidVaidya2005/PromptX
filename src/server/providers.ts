import 'server-only'

import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogle } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import type { LanguageModel } from 'ai'

import { PROVIDER_LABELS, SHARED_MODEL_ID, SITE_URL } from '@/lib/constants'
import { findModel, isSharedModel, MODEL_CATALOG } from '@/lib/models'

import { serverEnv } from '@/server/env'
import { getDecryptedKey } from '@/server/keys'
import { reserveSharedSlot } from '@/server/quota'

import type { Provider } from '@/types/domain'

export type ResolvedModel = {
  model: LanguageModel
  usedSharedKey: boolean
}

/**
 * Decides which key answers a request, and whether the shared quota applies.
 *
 * Every chat request goes through here. No route may construct a provider
 * client directly — that is what keeps "which key paid for this" answerable in
 * one place.
 *
 * The order below is the feature. The catalog check is first because it is the
 * only one that costs nothing: refusing an unknown model before the key lookup
 * saves a database round trip and a decrypt for a request that could not have
 * succeeded. Then the caller's own key, then the shared key as the sole
 * fallback. A user with their own key is never quota-checked, which is why that
 * branch returns before feature 16's reservation is ever reached.
 *
 * @throws UnknownModelError when the model is not in `src/lib/models.ts` (400).
 * @throws MissingKeyError when the provider has no key and is not the shared
 *   fallback (400).
 * @throws QuotaExceededError when the shared key's daily allowance is spent (429).
 */
export async function resolveModel(
  userId: string,
  provider: Provider,
  modelId: string,
): Promise<ResolvedModel> {
  if (!findModel(provider, modelId)) {
    throw new UnknownModelError(provider, modelId)
  }

  // Plaintext, and it stays a local. It is handed straight to a factory and
  // falls out of scope — never logged, never returned, never held in a module.
  const apiKey = await getDecryptedKey(provider)

  if (apiKey) {
    return { model: instantiate(provider, modelId, apiKey), usedSharedKey: false }
  }

  // No personal key: the shared Gemini key is the only fallback, and only for
  // the one model it serves. Anything else is a missing key, not a bad request.
  //
  // `isSharedModel` rather than the comparison written out, because F15's picker
  // has to grey out exactly what this refuses. Two spellings of one rule would
  // drift silently — into a picker offering a model every send then rejects.
  if (!isSharedModel(provider, modelId)) {
    throw new MissingKeyError(provider)
  }

  // Claims one slot atomically, or throws QuotaExceededError (429). On this side
  // of the return by design: the caller has written nothing yet, so a refusal
  // leaves no conversation and no prompt without an answer.
  //
  // Only this branch is reached by a keyless user. A caller with their own key
  // returned above, which is what keeps them out of the quota path entirely
  // rather than exempting them from it by a condition somebody has to remember.
  //
  // FEATURE 17 checks the global circuit breaker immediately BEFORE this line —
  // a tripped breaker must refuse without consuming anybody's daily slot.
  await reserveSharedSlot(userId)

  return {
    model: instantiate('google', SHARED_MODEL_ID, serverEnv.SHARED_GEMINI_API_KEY),
    usedSharedKey: true,
  }
}

/**
 * A provider client for one key, built fresh for this request.
 *
 * Never cached at module scope, and the reason is not performance: a
 * module-level instance would capture whichever user's decrypted key built it
 * and serve that key to whoever asked next. Construction is cheap — it allocates
 * an object and makes no network call — so there is nothing to gain by holding
 * one anyway.
 */
function instantiate(provider: Provider, modelId: string, apiKey: string): LanguageModel {
  switch (provider) {
    case 'openai':
      return createOpenAI({ apiKey })(modelId)
    case 'anthropic':
      return createAnthropic({ apiKey })(modelId)
    case 'google':
      return createGoogle({ apiKey })(modelId)
    case 'openrouter':
      return createOpenRouter({
        apiKey,
        // Attribution on the user's own OpenRouter dashboard, so a request they
        // are paying for is identifiable as ours. Sets X-OpenRouter-Title and
        // HTTP-Referer respectively.
        appName: 'PromptX',
        appUrl: SITE_URL,
        // NOT the default. createOpenRouter() defaults to 'compatible', which
        // omits `stream_options: { include_usage: true }` — so a streamed
        // response reports NO usage at all, `onEnd` sees undefined token counts,
        // and every OpenRouter message would persist with null input/output
        // tokens. Feature 17's breaker is fed by measured usage only, so that
        // silence would read as "this cost nothing". The package's own default
        // export passes 'strict' for exactly this reason.
        compatibility: 'strict',
        // `.chat()` rather than calling the provider directly: the callable's
        // first type overload resolves to a COMPLETION model, while the runtime
        // dispatches to chat. Being explicit keeps the type honest.
      }).chat(modelId)
  }
}

/**
 * The shared model, for system overhead rather than for a user's message.
 *
 * Deliberately NOT `resolveModel()`, and the separation is the whole point.
 * Feature 16 inserts `reserveSharedSlot()` into that function — route titling
 * through there and the day it lands, every conversation silently costs its
 * owner one of twenty daily messages for a title they never asked for. Nothing
 * on screen would say so. A second entry point cannot drift into claiming a
 * slot, because there is no slot logic on this path to begin with.
 *
 * It still lives in this file rather than in the caller, because
 * `SHARED_GEMINI_API_KEY` is read here and nowhere else.
 *
 * FEATURE 17: the tokens this model spends are real money and belong in
 * `shared_key_budget`. The ledger, the service-role client, and
 * `record_shared_tokens` all arrive with `src/server/quota.ts` at that feature —
 * see the reconciliation note in `src/server/titles.ts`. What must never be
 * added is `reserveSharedSlot()`: accounted, not charged.
 */
export function sharedTitleModel(): LanguageModel {
  return instantiate('google', SHARED_MODEL_ID, serverEnv.SHARED_GEMINI_API_KEY)
}

/** Thrown when a provider is selected that the caller has no key for. Maps to 400. */
export class MissingKeyError extends Error {
  constructor(readonly provider: Provider) {
    super(`No API key configured for ${provider}`)
    this.name = 'MissingKeyError'
  }
}

/**
 * Thrown when a model is not in `src/lib/models.ts`. Maps to 400.
 *
 * The message is built from the catalog rather than fixed, because the two cases
 * need different words. A provider with models means the id was wrong. A
 * provider with an EMPTY catalog means PromptX ships nothing for it yet — and
 * telling someone who just added a working key that their model id is unknown
 * would send them hunting for a typo that is not there.
 */
export class UnknownModelError extends Error {
  constructor(
    readonly provider: Provider,
    readonly modelId: string,
  ) {
    super(
      MODEL_CATALOG[provider].length === 0
        ? `PromptX has no ${PROVIDER_LABELS[provider]} models available yet`
        : `${PROVIDER_LABELS[provider]} does not offer a model called ${modelId} here`,
    )
    this.name = 'UnknownModelError'
  }
}
