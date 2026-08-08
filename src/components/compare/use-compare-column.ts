'use client'

import { useMemo } from 'react'

import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, type UIMessage } from 'ai'

import { refusalMessage } from '@/lib/compare'
import { textOf } from '@/lib/utils'

import type { Provider } from '@/types/domain'

export type CompareSide = 'left' | 'right'

export type CompareColumnState = {
  /** The answer so far. Empty until the first token arrives. */
  answer: string
  isStreaming: boolean
  /** A refusal or failure, already unwrapped into a sentence. */
  error: string | null
  /** Replaces whatever this column was showing and asks the new question. */
  send: (prompt: string) => void
  stop: () => void
}

/**
 * One column's half of a comparison.
 *
 * **A hook rather than a component owning its own `useChat`**, and the reason is
 * the send: both columns have to be asked the same question in one gesture, so
 * something has to hold both. A component per column would leave the parent
 * reaching into children through refs to start them, which is `useImperativeHandle`
 * for a problem that does not need it. Called twice, at fixed positions, from
 * `Compare` — two hook calls, no conditionals, nothing for the rules of hooks to
 * object to.
 *
 * Everything that makes a column independent is independent because these are
 * two `useChat` instances against two requests: `status`, `error` and `stop` are
 * per instance already, so stopping the left aborts the left fetch, and its
 * `request.signal` ends the left provider call. That is the whole argument for
 * one POST per column rather than the multiplexed response §31 first described —
 * see `src/app/api/compare/route.ts`.
 *
 * **The prompt travels in the body, not read back out of SDK state.** Same move
 * `Chat` makes for `editMessageId` and `attachmentIds`: the request shape is
 * this application's contract with its own route, and deriving it from however
 * the SDK happens to store a message would make the wire format an implementation
 * detail of the library. The appended message exists only so the hook has
 * something to stream an answer onto; it never goes anywhere.
 */
export function useCompareColumn(
  side: CompareSide,
  provider: Provider,
  modelId: string,
): CompareColumnState {
  // Rebuilt only when the model changes. A new object every render would hand
  // `useChat` a new transport on every keystroke in the prompt box, and the
  // closure below is why it must be rebuilt at all — a transport left on the
  // first render would keep sending to the model this column opened with,
  // however many times the picker was used. The same trap `Chat`'s memo names.
  const transport = useMemo(
    () =>
      new DefaultChatTransport<UIMessage>({
        api: '/api/compare',
        prepareSendMessagesRequest: ({ body }) => ({
          body: { provider, modelId, ...body },
        }),
      }),
    [provider, modelId],
  )

  const { messages, sendMessage, setMessages, status, stop, error } = useChat<UIMessage>({
    // Distinct ids, so the two columns cannot share state. Without them both
    // instances would address the same store and one answer would appear twice.
    id: `compare-${side}`,
    transport,
  })

  const answer = messages.findLast((message) => message.role === 'assistant')

  return {
    answer: answer ? textOf(answer) : '',
    isStreaming: status === 'submitted' || status === 'streaming',
    error: refusalMessage(error),
    send: (prompt: string) => {
      // Cleared first, so a second comparison does not leave the previous
      // answer on screen while the new one is still being asked for — the window
      // between pressing the button and the first token, where the last
      // assistant message would otherwise still be the old one.
      setMessages([])
      void sendMessage({ text: prompt }, { body: { prompt } })
    },
    stop: () => void stop(),
  }
}
