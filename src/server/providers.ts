import 'server-only'

import { createGoogle } from '@ai-sdk/google'
import type { LanguageModel } from 'ai'

import { SHARED_MODEL_ID } from '@/lib/constants'

import { serverEnv } from '@/server/env'

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
 * At this feature only the shared Gemini branch exists. The signature is final,
 * so features 14 and 16 fill the two marked gaps rather than rewriting callers.
 */
export async function resolveModel(
  userId: string,
  provider: Provider,
  modelId: string,
): Promise<ResolvedModel> {
  // FEATURE 14 INSERTS THE BYOK LOOKUP HERE:
  //   const apiKey = await getDecryptedKey(userId, provider)
  //   if (apiKey) return { model: instantiate(provider, modelId, apiKey), usedSharedKey: false }
  // Users with their own key are never quota-checked, so that branch returns
  // before the reservation below ever runs.
  void userId

  // No personal key: the shared Gemini key is the only fallback, and only for
  // the one model it serves. Anything else is a missing key, not a bad request.
  if (provider !== 'google' || modelId !== SHARED_MODEL_ID) {
    throw new MissingKeyError(provider)
  }

  // FEATURE 16 INSERTS THE QUOTA RESERVATION HERE:
  //   await reserveSharedSlot(userId)
  // It claims a slot atomically and throws QuotaExceededError (429) or
  // BudgetExhaustedError (503). It belongs on this side of the return, before
  // the caller has written anything, so a refusal leaves no trace.

  return {
    // Instantiated per request, never cached at module scope. Once feature 14
    // lands, a module-level instance would capture one user's decrypted key and
    // serve it to whoever asked next.
    model: createGoogle({ apiKey: serverEnv.SHARED_GEMINI_API_KEY })(SHARED_MODEL_ID),
    usedSharedKey: true,
  }
}

/** Thrown when a provider is selected that the caller has no key for. Maps to 400. */
export class MissingKeyError extends Error {
  constructor(readonly provider: Provider) {
    super(`No API key configured for ${provider}`)
    this.name = 'MissingKeyError'
  }
}
