'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'

import { OUTLINE_HIGHLIGHT_MS } from '@/lib/constants'
import type { ChatMessage } from '@/lib/messages'
import { outlineAnchorId, toOutlineEntries } from '@/lib/outline'

import { Composer } from '@/components/chat/Composer'
import { Thread } from '@/components/chat/Thread'
import { useModelMutation } from '@/components/chat/use-model-mutation'
import { useOutlineTracking } from '@/components/chat/use-outline-tracking'
import { useOutlinePublisher } from '@/components/shell/use-outline'

import type { Provider } from '@/types/domain'

type ChatProps = {
  /** Null on /chat. The server creates the conversation as the first answer streams. */
  conversationId: string | null
  initialMessages: ChatMessage[]
  provider: Provider
  modelId: string
  /** Providers this user holds a key for, for the picker's disabled states. */
  configuredProviders: readonly Provider[]
  /** Shared-key messages left today, read on the server for this render. */
  remaining: number
  /** False while the global monthly ceiling is spent. Irrelevant to a BYOK model. */
  sharedKeyAvailable: boolean
  /** Shown above the composer when there is nothing to read yet. */
  emptyState?: React.ReactNode
}

/**
 * The conversation surface, shared by /chat and /chat/[id].
 *
 * One component for both, because a new conversation and an existing one differ
 * only in whether `conversationId` is null. Splitting them would mean two
 * streaming paths to keep in step.
 *
 * A brand-new conversation has no URL while its first answer streams. The
 * server sends the id it created as a transient data part, `onData` catches it,
 * and the URL is corrected once the response finishes — a real navigation
 * rather than a history rewrite, so the router's idea of the route stays true.
 *
 * The chosen model is state here, seeded from the row. It is state rather than a
 * prop because it changes without a navigation, and it is seeded rather than
 * derived because the row is the source of truth on load. `/chat/[id]` passes a
 * `key` so switching conversations remounts this — without it the same component
 * survives the navigation and would show the previous conversation's model.
 */
export function Chat({
  conversationId,
  initialMessages,
  provider,
  modelId,
  configuredProviders,
  remaining,
  sharedKeyAvailable,
  emptyState,
}: ChatProps) {
  const router = useRouter()
  const createdConversationId = useRef<string | null>(null)

  /**
   * The database id of the row the last prompt became, until it is adopted.
   *
   * A ref for the same reason `createdConversationId` is one: it is a fact the
   * server reported mid-stream that nothing renders from, and it exists only
   * until `onFinish` puts it where it belongs.
   */
  const persistedPromptId = useRef<string | null>(null)
  const [model, setModel] = useState({ provider, modelId })
  const { changeModel, error: modelError } = useModelMutation()

  /**
   * Applies a model choice, and persists it when there is a row to persist to.
   *
   * On `/chat` there is no conversation yet — it is created by the first send —
   * so the choice is local and travels in the request body, which
   * `createConversation()` already writes. Nothing is lost by not persisting
   * here; there is simply nothing to persist to.
   *
   * The local state moves first and is not rolled back if the write fails. The
   * request that follows carries the same values in its body, so a failed PATCH
   * costs the persistence, not the intent — and the error says so.
   */
  function selectModel(nextProvider: Provider, nextModelId: string) {
    setModel({ provider: nextProvider, modelId: nextModelId })

    if (conversationId) {
      void changeModel(conversationId, { provider: nextProvider, modelId: nextModelId })
    }
  }

  /**
   * Asks the server to name a brand-new conversation, then refreshes again so
   * the sidebar picks the name up.
   *
   * A second refresh on purpose. The one in `onFinish` lands the message and the
   * new sidebar row immediately; this one lands the title a moment later, once
   * the model has produced it. Waiting for the title before the first refresh
   * would hold the whole sidebar back on a request nobody is waiting for.
   */
  async function nameConversation(id: string) {
    if (await requestTitle(id)) router.refresh()
  }

  // Rebuilding the transport every render would hand useChat a new object on
  // each keystroke.
  const transport = useMemo(
    () =>
      new DefaultChatTransport<ChatMessage>({
        api: '/api/chat',
        // Only the newest turn goes over the wire. The server loads history
        // from the database — a stated invariant, not an optimisation, because
        // a client must not be able to rewrite its own past turns.
        prepareSendMessagesRequest: ({ messages, body, trigger }) => ({
          body: {
            conversationId,
            provider: model.provider,
            modelId: model.modelId,

            /**
             * Which of the two request shapes this is, decided by the SDK
             * rather than by us. `regenerate()` sets `trigger` itself, so there
             * is no flag here for a caller to forget.
             *
             * The branch is load-bearing, and its absence would be silent.
             * `regenerate()` slices the assistant message out of client state
             * *before* calling the transport, which leaves the USER's prompt as
             * `messages[messages.length - 1]` — so sending it unconditionally
             * would ask the server to append a prompt it already stores, and
             * the thread would hold the same question twice. On screen it looks
             * perfect. Only the database disagrees, and only after a reload.
             *
             * `messageId` is deliberately NOT forwarded, though the SDK offers
             * it. It identifies a row only when the message came from the
             * server; one that has just streamed carries an id the SDK made up,
             * so sending it 400s the second regeneration of a page session. The
             * server reads which answer to replace from the thread instead.
             */
            ...(trigger === 'regenerate-message'
              ? { regenerate: true as const }
              : { message: messages[messages.length - 1] }),

            // Per-call overrides — feature 19's `editMessageId`, feature 20's
            // model — arrive here as `body` and are dropped on the floor unless
            // they are spread in. Losing one does not fail loudly: the request
            // is simply an ordinary send. Spread LAST so a regeneration against
            // a different model beats the composer's current choice above.
            ...body,
          },
        }),
      }),
    // The chosen model, not the prop: the closure captures these values, so a
    // transport left on the initial props would keep sending to the model the
    // conversation loaded with however many times the picker was used.
    [conversationId, model.provider, model.modelId],
  )

  const { messages, sendMessage, regenerate, setMessages, status, stop, error } =
    useChat<ChatMessage>({
      // Gives each conversation its own isolated state when switching between them.
      id: conversationId ?? 'new',
      messages: initialMessages,
      transport,
      onData: (part) => {
        if (part.type === 'data-conversation') {
          createdConversationId.current = (part.data as { id: string }).id
        }

        // The row this turn's prompt became. Adopted in onFinish rather than
        // here: rewriting a message's id mid-stream would change its React key
        // and tear down the bubble that is currently being written into.
        if (part.type === 'data-prompt-message') {
          persistedPromptId.current = (part.data as { id: string }).id
        }
      },
      onFinish: () => {
        adoptPersistedPromptId()

        const created = createdConversationId.current

        if (created) {
          createdConversationId.current = null
          router.replace(`/chat/${created}`)
        }

        // Required in both cases: Next preserves a layout across navigation, and
        // the sidebar's conversation query lives in that layout. Without this a
        // new conversation never appears and an existing one never moves up.
        router.refresh()

        // Only the request that created the conversation asks for a title, which
        // is exactly the request whose exchange the title is drawn from. Every
        // later message skips it, so there is no round trip per turn forever.
        //
        // Deliberately not awaited: onFinish must not block on it, and there is
        // nothing to do if it fails. The server refuses idempotently, so an
        // interrupted first answer simply leaves the conversation as 'New chat'.
        if (created) void nameConversation(created)
      },
    })

  const isStreaming = status === 'submitted' || status === 'streaming'

  /**
   * The thread as it was before something removed part of it optimistically,
   * held until the request is known to have been accepted.
   *
   * Two paths write it and they have the same shape: an edit truncates from the
   * rewritten prompt, and `regenerate()` drops the answer it is replacing —
   * both before the server has agreed to anything. A ref rather than state
   * because nothing renders from it; it exists only so the effect below can put
   * the messages back.
   */
  const restorePoint = useRef<ChatMessage[] | null>(null)

  /**
   * Replaces the last prompt's invented id with the row it actually became.
   *
   * The client mints an id for the message it renders the moment someone
   * presses send; the database mints a different one when the row is written.
   * Nothing minds the difference until something has to *name* that row — and
   * feature 19's edit does, which is how this surfaced: editing a message sent
   * in the same page session put an SDK id where the route required a uuid and
   * was refused. A reload fixed it, which is exactly what made it easy to miss.
   *
   * Only the trailing prompt is touched. Everything before it either came from
   * the server already or was corrected by this same call on its own turn.
   */
  function adoptPersistedPromptId() {
    const persisted = persistedPromptId.current
    if (!persisted) return

    persistedPromptId.current = null

    setMessages((current) => {
      const index = current.findLastIndex((message) => message.role === 'user')
      const prompt = current[index]
      if (!prompt || prompt.id === persisted) return current

      const next = [...current]
      next[index] = { ...prompt, id: persisted }
      return next
    })
  }

  /**
   * Rewrites a prompt and regenerates from it, dropping everything after it.
   *
   * `messageId` is the SDK's own edit primitive, not a hand-rolled truncation:
   * it slices the thread to include that message, then replaces it **in place,
   * keeping its id**. That last part is why it is used here. The earlier version
   * called `setMessages(slice)` and then `sendMessage({ text })`, which pushed a
   * *new* message with a *new* invented id — while the database had updated the
   * original row and kept its uuid. The two then disagreed about what the
   * rewritten prompt was called, so editing the same message twice in one
   * session sent an id the server had never issued.
   *
   * The server is told which row to rewrite through a per-call body override, so
   * the id never has to live in React state where every other send path would
   * have to remember to clear it.
   */
  function editMessage(messageId: string, nextText: string) {
    // Guarded because `sendMessage` throws — not rejects — when the id is not in
    // the thread or is not a user message, and this call is deliberately not
    // awaited.
    const target = messages.find((candidate) => candidate.id === messageId)
    if (!target || target.role !== 'user') return

    restorePoint.current = messages

    void sendMessage(
      { text: nextText, messageId },
      { body: { editMessageId: messageId } },
    )
  }

  /**
   * Asks for a second answer to a prompt that has already been sent.
   *
   * No truncation here, unlike `editMessage` above: `regenerate()` removes the
   * assistant message from client state itself before it calls the transport.
   * The snapshot is still taken, because that removal is just as optimistic —
   * the server can refuse on quota and never delete anything.
   *
   * `model` is passed through as a per-call body override rather than set on
   * the composer. Nothing here calls `useModelMutation`, so the conversation's
   * own provider and model are untouched and only the new assistant row records
   * the choice.
   */
  function regenerateMessage(
    messageId: string,
    model?: { provider: Provider; modelId: string },
  ) {
    restorePoint.current = messages
    void regenerate({ messageId, body: model })
  }

  /**
   * Puts the thread back when an edit or a regeneration is refused.
   *
   * This is what makes the optimistic removal safe, and it keys off `status`
   * rather than a rejected promise because neither `sendMessage` nor
   * `regenerate` rejects — measured against the installed SDK, whose
   * `makeRequest` catches, calls `onError`, and sets `status: 'error'`. A
   * `.catch()` here would look right, compile, and never once run.
   *
   * The server deletes strictly *after* the model resolves and the quota slot
   * is claimed, so a spent allowance or a tripped breaker removes nothing. Only
   * the screen lost those messages, and only the screen has to restore them.
   *
   * The snapshot is dropped the moment tokens start arriving: past that point
   * the server really has deleted, and a later stream failure must leave the
   * thread as it is rather than resurrecting messages the database no longer
   * holds.
   */
  useEffect(() => {
    if (status === 'streaming') {
      restorePoint.current = null
      return
    }

    if (status !== 'error' || !restorePoint.current) return

    const restore = restorePoint.current
    restorePoint.current = null
    setMessages(restore)
  }, [status, setMessages])

  /**
   * The outline rail's entries, and the reason they cost nothing.
   *
   * This is the same array the thread is rendering — no second query and no
   * second read of the same rows, which is what "derived from the already-loaded
   * thread" means. What it needs is a stable *identity*: `messages` gets a new
   * one on every streamed token, and an unmemoised list would publish upwards
   * dozens of times per response and rebuild the rail's observer with it.
   *
   * The key is built from the derived entries rather than from `messages`, so it
   * covers both ways the outline can change and no way it cannot. Ids alone
   * would be cheaper and would be wrong at feature 19: editing a prompt keeps
   * its id and changes its text, and the rail would keep showing the old wording
   * with nothing to explain why. An assistant message growing changes neither.
   *
   * This memo is load-bearing rather than an optimisation.
   */
  const derivedEntries = toOutlineEntries(messages)
  const outlineKey = derivedEntries
    .map((entry) => `${entry.id}:${entry.label}`)
    .join('\n')

  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on outlineKey, see above
  const entries = useMemo(() => derivedEntries, [outlineKey])

  const scrollRef = useRef<HTMLDivElement>(null)
  const activeId = useOutlineTracking(scrollRef, entries)

  const [highlightedId, setHighlightedId] = useState<string | null>(null)
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  /**
   * Scrolls the thread to a message and flashes it.
   *
   * Lives here rather than in the rail because this component owns the scroll
   * container. The rail knows which message it wants and nothing about how to
   * reach it.
   *
   * `scrollIntoView`'s own `behavior` overrides the CSS `scroll-behavior` that
   * globals.css neutralises under prefers-reduced-motion, so the media query has
   * to be asked directly — the stylesheet cannot reach this call.
   */
  const jumpTo = useCallback((messageId: string) => {
    const anchor = document.getElementById(outlineAnchorId(messageId))
    if (!anchor) return

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    anchor.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' })

    if (highlightTimer.current) clearTimeout(highlightTimer.current)
    setHighlightedId(messageId)

    highlightTimer.current = setTimeout(() => {
      highlightTimer.current = null
      setHighlightedId(null)
    }, OUTLINE_HIGHLIGHT_MS)
  }, [])

  useEffect(
    () => () => {
      if (highlightTimer.current) clearTimeout(highlightTimer.current)
    },
    [],
  )

  const publisher = useOutlinePublisher()

  useEffect(() => {
    if (!publisher) return

    publisher.publish({ entries, activeId, jumpTo })

    // Clearing on unmount is what keeps the rail honest across a navigation.
    // Without it, leaving for /settings would carry this conversation's outline
    // onto a page that has no thread at all — and the shell decides whether the
    // whole right column exists from the entry count, so a stale one would keep
    // a column alive on every route the user visits next.
    return () => publisher.publish({ entries: [], activeId: null, jumpTo: () => {} })
  }, [publisher, entries, activeId, jumpTo])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        {messages.length === 0 && emptyState ? (
          emptyState
        ) : (
          <Thread
            messages={messages}
            isStreaming={isStreaming}
            provider={model.provider}
            modelId={model.modelId}
            configuredProviders={configuredProviders}
            remaining={remaining}
            sharedKeyAvailable={sharedKeyAvailable}
            highlightedId={highlightedId}
            onEdit={editMessage}
            onRegenerate={regenerateMessage}
          />
        )}
      </div>

      {/* The hook's own error, as distinct from a message that failed after
          partially arriving — that one carries its error in the thread. */}
      {error && (
        <p
          role="alert"
          className="mx-auto w-full max-w-180 px-lg text-body-sm text-danger"
        >
          Something went wrong. Try sending that again.
        </p>
      )}

      {/* A different request with a different failure. The choice still applies
          to the next message even when persisting it did not land, so this says
          what did not happen rather than asking for the send again. */}
      {modelError && (
        <p
          role="alert"
          className="mx-auto w-full max-w-180 px-lg text-body-sm text-danger"
        >
          {modelError}
        </p>
      )}

      <Composer
        provider={model.provider}
        modelId={model.modelId}
        configuredProviders={configuredProviders}
        remaining={remaining}
        sharedKeyAvailable={sharedKeyAvailable}
        onSelectModel={selectModel}
        isStreaming={isStreaming}
        onSend={(text) => void sendMessage({ text })}
        onStop={() => void stop()}
      />
    </div>
  )
}

/**
 * True when the server actually wrote a title.
 *
 * False covers every other outcome identically — refused, already named, model
 * failed, network down — because the caller does the same thing in all of them:
 * nothing. Titling is a courtesy, and a conversation called 'New chat' is a
 * working conversation.
 */
async function requestTitle(conversationId: string): Promise<boolean> {
  try {
    const response = await fetch('/api/title', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId }),
    })

    if (!response.ok) return false

    const { title } = (await response.json()) as { title: string | null }
    return title !== null
  } catch {
    return false
  }
}
