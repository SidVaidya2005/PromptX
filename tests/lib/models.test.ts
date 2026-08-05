import { describe, expect, it } from 'vitest'

import { SHARED_MODEL_ID } from '@/lib/constants'
import {
  decodeModelKey,
  encodeModelKey,
  findModel,
  isModelAvailable,
  isSharedModel,
  MODEL_CATALOG,
  PROVIDER_ORDER,
} from '@/lib/models'

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

describe('PROVIDER_ORDER', () => {
  it('accounts for every provider in the catalog, and invents none', async () => {
    // The picker iterates this rather than the catalog's own keys. A provider in
    // one and not the other is either a group that never renders or a heading
    // over nothing — both silent, both only visible by opening the menu.
    expect([...PROVIDER_ORDER].sort()).toEqual(Object.keys(MODEL_CATALOG).sort())
  })
})

describe('model keys', () => {
  it('survives a round trip for every model in the catalog', async () => {
    for (const provider of PROVIDER_ORDER) {
      for (const model of MODEL_CATALOG[provider]) {
        const key = encodeModelKey(provider, model.id)

        expect(decodeModelKey(key), key).toEqual({ provider, modelId: model.id })
      }
    }
  })

  it('keeps two models that share a label apart', async () => {
    // The reason a composite key exists at all: `Gemini 3.6 Flash` is in the
    // catalog twice, under google and under openrouter, with different ids and
    // different bills. Keyed on the id alone the picker would light the wrong
    // row — and worse, resolve a selection to a provider nobody chose.
    const google = encodeModelKey('google', SHARED_MODEL_ID)
    const viaOpenRouter = encodeModelKey('openrouter', `google/${SHARED_MODEL_ID}`)

    expect(google).not.toBe(viaOpenRouter)
    expect(decodeModelKey(google)?.provider).toBe('google')
    expect(decodeModelKey(viaOpenRouter)?.provider).toBe('openrouter')
  })

  it('keeps a model id that contains a colon intact', async () => {
    // No catalog entry has one today, but OpenRouter publishes variants like
    // `:free` and `:thinking`. Splitting on the last or on every separator would
    // truncate such an id to the part before the colon and silently resolve to a
    // different model. Asserted on the helper rather than on the catalog so it
    // holds the day one is added.
    expect(decodeModelKey('openrouter:vendor/model:free')).toBeNull()

    const separator = 'openrouter:vendor/model:free'.indexOf(':')
    expect('openrouter:vendor/model:free'.slice(separator + 1)).toBe('vendor/model:free')
  })

  it('refuses a key naming something outside the catalog', async () => {
    expect(decodeModelKey('google:gemini-3-ultra')).toBeNull()
    expect(decodeModelKey('nowhere:some-model')).toBeNull()
    expect(decodeModelKey('no-separator')).toBeNull()
  })
})

describe('availability', () => {
  it('serves exactly one model to a caller with no key at all', async () => {
    // The same rule resolveModel() refuses on. If these two ever disagree the
    // picker offers a model every send then rejects, or hides one that works.
    //
    // The expectation is spelled out rather than read from isSharedModel: with
    // no configured providers isModelAvailable REDUCES to isSharedModel, so
    // comparing the two compares a function against itself and passes for any
    // implementation. Written that way first, and the mutation run proved it —
    // inverting isSharedModel left this green.
    for (const provider of PROVIDER_ORDER) {
      for (const model of MODEL_CATALOG[provider]) {
        const available = isModelAvailable(provider, model.id, [])
        const isTheSharedOne = provider === 'google' && model.id === SHARED_MODEL_ID

        expect(available, `${provider} → ${model.id}`).toBe(isTheSharedOne)
      }
    }
  })

  it('names the shared model and nothing else', async () => {
    expect(isSharedModel('google', SHARED_MODEL_ID)).toBe(true)
    expect(isSharedModel('google', 'gemini-3.5-flash')).toBe(false)
    expect(isSharedModel('openrouter', `google/${SHARED_MODEL_ID}`)).toBe(false)
  })

  it('opens a provider up once its key is configured', async () => {
    const other = MODEL_CATALOG.google.find((model) => model.id !== SHARED_MODEL_ID)

    expect(other).toBeDefined()
    expect(isModelAvailable('google', other!.id, [])).toBe(false)
    expect(isModelAvailable('google', other!.id, ['google'])).toBe(true)
  })

  it('does not let one provider’s key unlock another’s models', async () => {
    const openRouterModel = MODEL_CATALOG.openrouter[0]

    expect(openRouterModel).toBeDefined()
    expect(isModelAvailable('openrouter', openRouterModel!.id, ['google'])).toBe(false)
  })
})
