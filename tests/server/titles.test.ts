import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_CONVERSATION_TITLE,
  TITLE_SOURCE_CHAR_LIMIT,
} from '@/lib/constants'

/**
 * Auto-titling is the one path that spends the shared key without anybody having
 * asked for anything, which makes its refusals the interesting part rather than
 * its happy case.
 *
 * Three separate obligations meet in this function and each has a test that goes
 * red on its own:
 *
 * - **the F21 rename guard** — a conversation somebody has named themselves is
 *   never re-titled, and that is held by the default-title check rather than by a
 *   column recording that a human named it
 * - **the F17 breaker obligation** — titling is skipped entirely while the
 *   monthly ceiling is tripped, or the ceiling would stop every message and go on
 *   paying for titles
 * - **accounted, never charged** — the tokens reach `shared_key_budget` through
 *   `recordSharedBudgetTokens()`, which takes no user id, and never a daily row.
 *   The reconciliation sweep cannot cover for a miss here: it derives usage from
 *   `messages` rows and a title writes none, so those tokens are invisible to it
 *   by construction
 *
 * The ordering matters as much as the outcomes. Every gate sits above the
 * provider call, which is what lets the client fire this optimistically — a
 * repeat call costs two indexed reads and no money.
 */

const getConversation = vi.fn()
const setGeneratedTitle = vi.fn()
const listByConversation = vi.fn()
const sharedTitleModel = vi.fn(() => ({ id: 'shared-title-model' }))
const isSharedKeyAvailable = vi.fn()
const recordSharedBudgetTokens = vi.fn()
const generateText = vi.fn()

vi.mock('@/server/data/conversations', () => ({ getConversation, setGeneratedTitle }))
vi.mock('@/server/data/messages', () => ({ listByConversation }))
vi.mock('@/server/providers', () => ({ sharedTitleModel }))
vi.mock('@/server/quota', () => ({ isSharedKeyAvailable, recordSharedBudgetTokens }))
vi.mock('ai', () => ({ generateText }))

const CONVERSATION_ID = '00000000-0000-4000-8000-0000000000c1'

const USAGE = { inputTokens: 402, outputTokens: 9 }

function thread(overrides: { answerStatus?: string; withPrompt?: boolean } = {}) {
  const { answerStatus = 'complete', withPrompt = true } = overrides

  return [
    ...(withPrompt
      ? [{ role: 'user', content: 'How do I pin a conversation?', status: 'complete' }]
      : []),
    { role: 'assistant', content: 'Use the overflow menu.', status: answerStatus },
  ]
}

/** The ordinary case: an untitled conversation with one complete exchange. */
function seedHappyPath() {
  getConversation.mockResolvedValue({
    id: CONVERSATION_ID,
    title: DEFAULT_CONVERSATION_TITLE,
  })
  listByConversation.mockResolvedValue(thread())
  isSharedKeyAvailable.mockResolvedValue(true)
  generateText.mockResolvedValue({ text: 'Pinning a conversation', usage: USAGE })
  setGeneratedTitle.mockResolvedValue(true)
}

async function titleConversation(): Promise<string | null> {
  const { generateConversationTitle } = await import('@/server/titles')
  return generateConversationTitle(CONVERSATION_ID)
}

beforeEach(() => {
  vi.resetModules()
  for (const mock of [
    getConversation,
    setGeneratedTitle,
    listByConversation,
    isSharedKeyAvailable,
    recordSharedBudgetTokens,
    generateText,
  ]) {
    mock.mockReset()
  }
  sharedTitleModel.mockClear()
})

describe('naming a conversation', () => {
  it('stores the normalised title and hands it back', async () => {
    seedHappyPath()
    generateText.mockResolvedValue({ text: '  "Pinning a conversation."  ', usage: USAGE })

    expect(await titleConversation()).toBe('Pinning a conversation')
    expect(setGeneratedTitle).toHaveBeenCalledWith(
      CONVERSATION_ID,
      'Pinning a conversation',
    )
  })

  it('labels both halves of the exchange, so the title is not taken from whichever is longer', async () => {
    seedHappyPath()

    await titleConversation()

    const prompt = generateText.mock.calls[0]?.[0]?.prompt as string
    expect(prompt).toContain('User message:')
    expect(prompt).toContain('How do I pin a conversation?')
    expect(prompt).toContain('Assistant reply:')
    expect(prompt).toContain('Use the overflow menu.')
  })

  it('clips a long message rather than sending the whole thing', async () => {
    seedHappyPath()
    listByConversation.mockResolvedValue([
      { role: 'user', content: 'x'.repeat(TITLE_SOURCE_CHAR_LIMIT + 500), status: 'complete' },
      { role: 'assistant', content: 'short', status: 'complete' },
    ])

    await titleConversation()

    const prompt = generateText.mock.calls[0]?.[0]?.prompt as string
    expect(prompt).toContain('…')
    expect(prompt.length).toBeLessThan(TITLE_SOURCE_CHAR_LIMIT + 200)
  })

  it('bounds the call with an abort signal, like every other provider call', async () => {
    seedHappyPath()

    await titleConversation()

    expect(generateText.mock.calls[0]?.[0]?.abortSignal).toBeInstanceOf(AbortSignal)
  })
})

describe('what titling refuses, all of it before any money is spent', () => {
  it('does nothing for a conversation that does not exist or is not the caller’s', async () => {
    // RLS filters "someone else's" into "absent", so both arrive here as null and
    // must stay indistinguishable.
    getConversation.mockResolvedValue(null)

    expect(await titleConversation()).toBeNull()
    expect(generateText).not.toHaveBeenCalled()
  })

  it('leaves a conversation the user has already named alone', async () => {
    // The F21 rename guard. There is no column recording that a human named it —
    // the title no longer being 'New chat' IS the record.
    getConversation.mockResolvedValue({ id: CONVERSATION_ID, title: 'Deploy notes' })

    expect(await titleConversation()).toBeNull()
    expect(listByConversation).not.toHaveBeenCalled()
    expect(generateText).not.toHaveBeenCalled()
  })

  it('waits for an answer that actually finished', async () => {
    // A conversation whose first reply was stopped or failed has nothing worth
    // naming, and would otherwise be named after half a sentence.
    getConversation.mockResolvedValue({
      id: CONVERSATION_ID,
      title: DEFAULT_CONVERSATION_TITLE,
    })
    listByConversation.mockResolvedValue(thread({ answerStatus: 'error' }))

    expect(await titleConversation()).toBeNull()
    expect(generateText).not.toHaveBeenCalled()
  })

  it('does nothing for a thread with no user message', async () => {
    getConversation.mockResolvedValue({
      id: CONVERSATION_ID,
      title: DEFAULT_CONVERSATION_TITLE,
    })
    listByConversation.mockResolvedValue(thread({ withPrompt: false }))

    expect(await titleConversation()).toBeNull()
    expect(generateText).not.toHaveBeenCalled()
  })

  it('skips titling entirely while the monthly breaker is tripped', async () => {
    // F17's obligation. Without it the ceiling stops every user message and the
    // shared key goes on paying for titles nobody asked for.
    seedHappyPath()
    isSharedKeyAvailable.mockResolvedValue(false)

    expect(await titleConversation()).toBeNull()
    expect(generateText).not.toHaveBeenCalled()
    expect(recordSharedBudgetTokens).not.toHaveBeenCalled()
  })

  it('checks the breaker only after the two free checks, so a repeat call costs nothing', async () => {
    getConversation.mockResolvedValue({ id: CONVERSATION_ID, title: 'Already named' })

    await titleConversation()

    expect(isSharedKeyAvailable).not.toHaveBeenCalled()
  })
})

describe('accounted, never charged', () => {
  it('records the measured tokens against the budget', async () => {
    seedHappyPath()

    await titleConversation()

    expect(recordSharedBudgetTokens).toHaveBeenCalledWith(USAGE)
  })

  it('records the spend even when the title turns out to be unusable', async () => {
    // The money was gone the moment the call returned. Recording after
    // normalising would lose every title that came back as punctuation or an
    // empty string — a silent undercount on the ledger that drives the breaker.
    seedHappyPath()
    generateText.mockResolvedValue({ text: '  "" . ', usage: USAGE })

    expect(await titleConversation()).toBeNull()
    expect(recordSharedBudgetTokens).toHaveBeenCalledWith(USAGE)
    expect(setGeneratedTitle).not.toHaveBeenCalled()
  })

  it('reaches the shared key through sharedTitleModel, which has no user to charge', async () => {
    // The structural half of "never charged": this entry point takes no user id,
    // so there is nobody a daily slot could be claimed against. Routing titling
    // through resolveModel() would charge a user a message for a title they
    // never asked for, because that function reserves a slot.
    seedHappyPath()

    await titleConversation()

    expect(sharedTitleModel).toHaveBeenCalledWith()
    expect(sharedTitleModel.mock.calls[0]).toHaveLength(0)
  })
})

describe('never interrupting a working chat', () => {
  it('returns null instead of throwing when the provider fails', async () => {
    seedHappyPath()
    generateText.mockRejectedValue(new Error('provider exploded'))

    await expect(titleConversation()).resolves.toBeNull()
  })

  it('returns null instead of throwing when the database fails', async () => {
    getConversation.mockRejectedValue(new Error('connection reset'))

    await expect(titleConversation()).resolves.toBeNull()
  })

  it('discards its title when the row was renamed while the call was in flight', async () => {
    seedHappyPath()
    setGeneratedTitle.mockResolvedValue(false)

    expect(await titleConversation()).toBeNull()
  })
})
