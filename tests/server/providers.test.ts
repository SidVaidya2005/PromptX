import { describe, expect, it } from 'vitest'

import { SHARED_MODEL_ID } from '@/lib/constants'

import { MissingKeyError, resolveModel } from '@/server/providers'

const USER_ID = '00000000-0000-4000-8000-000000000001'

/**
 * resolveModel is the single place that decides which key answers a request.
 * Nothing here reaches a provider — instantiating a model makes no network
 * call, and no test in this project may spend money.
 *
 * The shared key is the only fallback for a user without one of their own, and
 * it serves exactly one model. Every other combination has to be refused, or
 * feature 14's BYOK path would have a hole underneath it.
 */
describe('resolveModel', () => {
  it('serves Gemini on the shared key and says so', async () => {
    const resolved = await resolveModel(USER_ID, 'google', SHARED_MODEL_ID)

    expect(resolved.usedSharedKey).toBe(true)
    expect(resolved.model).toBeDefined()
  })

  it('refuses a provider the caller has no key for', async () => {
    await expect(resolveModel(USER_ID, 'openai', 'gpt-5')).rejects.toBeInstanceOf(
      MissingKeyError,
    )
    await expect(
      resolveModel(USER_ID, 'anthropic', 'claude-opus-5'),
    ).rejects.toBeInstanceOf(MissingKeyError)
    await expect(
      resolveModel(USER_ID, 'openrouter', 'anthropic/claude-opus-5'),
    ).rejects.toBeInstanceOf(MissingKeyError)
  })

  it('refuses a Google model that is not the shared one', async () => {
    // The shared key pays for one model. Without this check a keyless user
    // could reach anything Google sells on someone else's bill.
    await expect(
      resolveModel(USER_ID, 'google', 'gemini-3-ultra'),
    ).rejects.toBeInstanceOf(MissingKeyError)
  })

  it('names the provider on the error, for the message the user sees', async () => {
    await expect(resolveModel(USER_ID, 'openai', 'gpt-5')).rejects.toMatchObject({
      provider: 'openai',
      name: 'MissingKeyError',
    })
  })
})
