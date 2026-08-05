import { describe, expect, it } from 'vitest'

import { SHARED_MODEL_ID } from '@/lib/constants'
import { findModel, MODEL_CATALOG } from '@/lib/models'

import type { Provider } from '@/types/domain'

/**
 * The catalog is hand-maintained data, and `resolveModel()` refuses anything
 * absent from it — so an authoring mistake here is a model nobody can reach, or
 * worse, an id sent to a provider that cannot parse it.
 *
 * These assert the properties that a careful reader would otherwise have to
 * re-check by eye every time an entry is added. Whether an id actually GENERATES
 * cannot be proven here: that needs a live key and real money, and it is done by
 * hand at the feature that adds the entry. See the note at the top of
 * src/lib/models.ts.
 */

const NATIVE_PROVIDERS: Provider[] = ['openai', 'anthropic', 'google']

describe('MODEL_CATALOG', () => {
  it('offers the shared model, or the shared key would refuse itself', async () => {
    // resolveModel checks the catalog before it checks anything else, so a
    // google catalog missing this id breaks the keyless path for every user —
    // the one path that has to work thirty seconds after signing in.
    expect(findModel('google', SHARED_MODEL_ID)).not.toBeNull()
  })

  it('namespaces every OpenRouter id as vendor/model', async () => {
    // OpenRouter routes on the vendor prefix; a bare id is a 404 from them.
    for (const model of MODEL_CATALOG.openrouter) {
      expect(model.id.split('/'), model.id).toHaveLength(2)
    }
  })

  it('never namespaces an id for a provider that speaks to its own API', async () => {
    // The mirror of the rule above, and the one that actually catches a mistake:
    // pasting `google/gemini-3.6-flash` under `google` looks right and would be
    // sent verbatim to Google, which has never heard of it.
    for (const provider of NATIVE_PROVIDERS) {
      for (const model of MODEL_CATALOG[provider]) {
        expect(model.id, `${provider} → ${model.id}`).not.toContain('/')
      }
    }
  })

  it('lists each model once per provider', async () => {
    for (const [provider, models] of Object.entries(MODEL_CATALOG)) {
      const ids = models.map((model) => model.id)

      expect(new Set(ids).size, provider).toBe(ids.length)
    }
  })

  it('describes every model completely enough to render it', async () => {
    // A blank label or a zero context window renders as an empty picker row,
    // which reads as a broken interface rather than as missing data.
    for (const [provider, models] of Object.entries(MODEL_CATALOG)) {
      for (const model of models) {
        expect(model.label.trim(), `${provider} → ${model.id}`).not.toBe('')
        expect(model.contextWindow, `${provider} → ${model.id}`).toBeGreaterThan(0)
      }
    }
  })
})

describe('findModel', () => {
  it('returns null for a model the provider does not serve', async () => {
    expect(findModel('google', 'gemini-3-ultra')).toBeNull()
  })

  it('does not find a model under the wrong provider', async () => {
    // Providers are separate namespaces. An OpenRouter id must not resolve
    // through Google just because the string exists somewhere in the catalog.
    const openRouterModel = MODEL_CATALOG.openrouter[0]

    expect(openRouterModel).toBeDefined()
    expect(findModel('google', openRouterModel!.id)).toBeNull()
  })
})
