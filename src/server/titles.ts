import 'server-only'

import { generateText } from 'ai'

import {
  DEFAULT_CONVERSATION_TITLE,
  MAX_TITLE_LENGTH,
  TITLE_SOURCE_CHAR_LIMIT,
  TITLE_TIMEOUT_MS,
} from '@/lib/constants'
import { normalizeTitle } from '@/lib/titles'

import { getConversation, setGeneratedTitle } from '@/server/data/conversations'
import { listByConversation } from '@/server/data/messages'
import { sharedTitleModel } from '@/server/providers'
import { isSharedKeyAvailable, recordSharedBudgetTokens } from '@/server/quota'

const TITLE_SYSTEM_PROMPT = [
  'You name chat conversations. You will be shown the opening exchange of one.',
  `Reply with a title of at most six words and ${MAX_TITLE_LENGTH} characters, and nothing else.`,
  'No quotation marks, no trailing punctuation, no preamble, no explanation.',
  'Name the subject the two of them are actually discussing, in sentence case.',
  'Write it in the language the user wrote in.',
].join(' ')

/**
 * Names a conversation from its first exchange, on the shared key.
 *
 * **Never throws and never reports.** Every refusal and every failure returns
 * null, and the conversation simply keeps its default title. A person who did
 * not ask for a title should not be shown an error for failing to get one, and
 * nothing downstream of this is worth interrupting a working chat over.
 *
 * Safe to call more than once for the same conversation. Everything that would
 * refuse is checked before the provider is reached, so a repeat call costs two
 * indexed reads and no money — which is what lets the client fire it optimistically.
 *
 * Quota policy, from `build-plan.md` feature 10: titling runs on the shared key
 * but is system overhead, so it claims **no** user slot — see
 * `sharedTitleModel()`, which is a separate entry point for exactly that reason.
 * Its tokens are still real money, so they go to `shared_key_budget` and only
 * there, through `recordSharedBudgetTokens()`, which takes no user id and so
 * cannot reach anybody's daily row. Accounted, never charged.
 *
 * The breaker is honoured here as well as in `resolveModel()`. Titling is the
 * one path that spends the shared key without a user having asked for anything,
 * so leaving it out would mean the ceiling stopped every message and went on
 * paying for titles.
 */
export async function generateConversationTitle(
  conversationId: string,
): Promise<string | null> {
  try {
    const conversation = await getConversation(conversationId)

    // Null covers "does not exist" and "belongs to someone else" identically,
    // because RLS filters the second into the first.
    if (!conversation) return null

    // The gate, and it sits above everything that costs anything. It is also
    // what protects a feature 21 rename: once a person has named a conversation
    // themselves, it is no longer 'New chat' and this never runs again.
    if (conversation.title !== DEFAULT_CONVERSATION_TITLE) return null

    const messages = await listByConversation(conversationId)
    const prompt = messages.find((message) => message.role === 'user')
    const answer = messages.find(
      (message) => message.role === 'assistant' && message.status === 'complete',
    )

    // A conversation whose first answer was stopped or failed has nothing worth
    // naming yet. It keeps 'New chat' rather than being named after half a
    // sentence the model had not finished.
    if (!prompt || !answer) return null

    // Below the two free checks above and above everything that costs money.
    // A conversation that goes untitled while the budget is spent keeps
    // 'New chat' and is titled by the next request after the month rolls over,
    // because the gate is still the default title rather than a flag.
    if (!(await isSharedKeyAvailable())) return null

    const { text, usage } = await generateText({
      model: sharedTitleModel(),
      system: TITLE_SYSTEM_PROMPT,
      prompt: buildSource(prompt.content, answer.content),
      // Bounded like every other provider call. Render will hold a request open
      // for 100 minutes and will not rescue us from a hung upstream.
      abortSignal: AbortSignal.timeout(TITLE_TIMEOUT_MS),
    })

    // Before the normalizing below, deliberately: the money was spent the moment
    // the call returned, so it is recorded even when the title turns out to be
    // unusable and this function goes on to return null.
    await recordSharedBudgetTokens(usage)

    const title = normalizeTitle(text)
    if (!title) return null

    // False when the row was renamed or titled while this was in flight, in
    // which case the other title won and this one is discarded.
    return (await setGeneratedTitle(conversationId, title)) ? title : null
  } catch (error) {
    console.error('[server/titles] could not title conversation', conversationId, error)
    return null
  }
}

/**
 * The two sides of the exchange, each clipped.
 *
 * Labelled rather than concatenated so the model can tell the question from the
 * answer — an unlabelled blob gets titled after whichever half is longer.
 */
function buildSource(prompt: string, answer: string): string {
  return [
    'User message:',
    clip(prompt),
    '',
    'Assistant reply:',
    clip(answer),
  ].join('\n')
}

function clip(value: string): string {
  return value.length <= TITLE_SOURCE_CHAR_LIMIT
    ? value
    : `${value.slice(0, TITLE_SOURCE_CHAR_LIMIT)}…`
}
