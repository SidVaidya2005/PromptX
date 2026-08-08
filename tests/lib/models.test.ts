import { describe, expect, it } from 'vitest'

import { ALLOWED_ATTACHMENT_MIME_TYPES, SHARED_MODEL_ID } from '@/lib/constants'
import {
  acceptedMimeTypes,
  acceptsMimeType,
  decodeModelKey,
  encodeModelKey,
  findModel,
  isModelAvailable,
  isSharedModel,
  MODEL_CATALOG,
  PROVIDER_ORDER,
  willUseSharedKey,
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

  it('spends the shared allowance only for the model the shared key serves', async () => {
    // Three surfaces read this and must agree: whether the meter is shown,
    // whether an exhausted allowance locks the composer, and whether the server
    // claims a slot. Written out literally rather than through isSharedModel,
    // for the reason the neighbouring test records.
    for (const provider of PROVIDER_ORDER) {
      for (const model of MODEL_CATALOG[provider]) {
        const shared = willUseSharedKey(provider, model.id, [])
        const isTheSharedOne = provider === 'google' && model.id === SHARED_MODEL_ID

        expect(shared, `${provider} → ${model.id}`).toBe(isTheSharedOne)
      }
    }
  })

  it('stops spending the allowance once the caller has their own Google key', async () => {
    // The same model, now billed to its owner. The meter must disappear and the
    // exhausted lock must lift, because resolveModel() would take the BYOK
    // branch and never reach the reservation.
    expect(willUseSharedKey('google', SHARED_MODEL_ID, [])).toBe(true)
    expect(willUseSharedKey('google', SHARED_MODEL_ID, ['google'])).toBe(false)
  })

  it('is not merely the inverse of availability', async () => {
    // A model can be available BECAUSE the caller has a key, in which case the
    // shared quota has nothing to do with the request. Both must be true at
    // once, which is why this is its own function rather than a negation.
    const openRouterModel = MODEL_CATALOG.openrouter[0]

    expect(openRouterModel).toBeDefined()
    expect(isModelAvailable('openrouter', openRouterModel!.id, ['openrouter'])).toBe(true)
    expect(willUseSharedKey('openrouter', openRouterModel!.id, ['openrouter'])).toBe(false)
  })

  it('does not let one provider’s key unlock another’s models', async () => {
    const openRouterModel = MODEL_CATALOG.openrouter[0]

    expect(openRouterModel).toBeDefined()
    expect(isModelAvailable('openrouter', openRouterModel!.id, ['google'])).toBe(false)
  })
})

/**
 * What a model will read, and the one place it is decided. (F30)
 *
 * Four surfaces consume this — the attach button, the file input's `accept`, the
 * warning before a model switch drops files, and the server's refusal — and the
 * first three are in the browser while the fourth is not. A second spelling
 * anywhere would offer what the server refuses or hide what would have worked.
 */
describe('acceptedMimeTypes', () => {
  it('gives a fully capable model every allowed type', () => {
    expect(acceptedMimeTypes('google', SHARED_MODEL_ID)).toEqual([
      ...ALLOWED_ATTACHMENT_MIME_TYPES,
    ])
  })

  it('gives a model that reads images but not PDFs only the image types', () => {
    const accepted = acceptedMimeTypes('openrouter', 'meta-llama/llama-4-maverick')

    expect(accepted).toContain('image/png')
    expect(accepted).not.toContain('application/pdf')

    // The case the whole per-file-type design exists for: the attach button
    // stays live and only the `accept` list narrows.
    expect(accepted.length).toBeGreaterThan(0)
  })

  it('gives a text-only model nothing', () => {
    expect(acceptedMimeTypes('openrouter', 'deepseek/deepseek-v4-flash')).toEqual([])
  })

  it('gives an unknown model nothing rather than everything', () => {
    // The safe direction. It is also not the error a user sees: resolveModel()
    // refuses an unknown id with unknown_model, and the callers here check
    // membership first so that refusal is the one that surfaces.
    expect(acceptedMimeTypes('google', 'no-such-model')).toEqual([])
    expect(acceptsMimeType('google', 'no-such-model', 'image/png')).toBe(false)
  })

  it('derives from the flags rather than restating them', () => {
    // Every entry's accepted list must agree with its own two booleans, so a
    // catalog row cannot claim a capability the list does not carry.
    for (const [provider, models] of Object.entries(MODEL_CATALOG)) {
      for (const model of models) {
        const accepted = acceptedMimeTypes(provider as Provider, model.id)

        expect(accepted.includes('application/pdf')).toBe(model.supportsPdf)
        expect(accepted.includes('image/png')).toBe(model.supportsImages)
      }
    }
  })
})

/**
 * The pin that keeps this feature from quietly becoming decorative.
 *
 * F30's gate — a disabled attach button, a warning on switching, a server
 * refusal — is only ever exercised by a model that refuses something. Every
 * entry F14 shipped accepted everything, which is why the gate had nothing to
 * reach it until this catalog gained a text-only model. If a later tidy-up
 * removes the last one, that is worth a red test rather than silence.
 */
describe('the catalog keeps the capability gate reachable', () => {
  it('still contains a model that accepts no files at all', () => {
    const entries = PROVIDER_ORDER.flatMap((provider) =>
      MODEL_CATALOG[provider].map((model) => acceptedMimeTypes(provider, model.id)),
    )

    expect(entries.some((accepted) => accepted.length === 0)).toBe(true)
  })
})
