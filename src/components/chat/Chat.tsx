'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'

import { OUTLINE_HIGHLIGHT_MS } from '@/lib/constants'
import type { ChatMessage } from '@/lib/messages'
import { outlineAnchorId, toOutlineEntries } from '@/lib/outline'

import { Composer } from '@/components/chat/Composer'
import { requestTitle } from '@/components/chat/request-title'
import { Thread, type AttachmentsByMessage } from '@/components/chat/Thread'
import { useModelMutation } from '@/components/chat/use-model-mutation'
import { useConversationMutation } from '@/components/sidebar/use-conversation-mutation'
import { useOutlineTracking } from '@/components/chat/use-outline-tracking'
import { useOutlinePublisher } from '@/components/shell/use-outline'

import type { Provider, RenderedAttachment } from '@/types/domain'

type ChatProps = {
  /** Null on /chat. The server creates the conversation as the first answer streams. */
  conversationId: string | null
  initialMessages: ChatMessage[]
  /**
   * The thread's files, keyed by message id and signed for this render. (F29)
   *
   * Beside the messages rather than inside them, because a message sent moments
   * ago exists only in `useChat` state — no server render can reach it to add
   * parts, and `router.refresh()` does not touch that state either.
   */
  initialAttachments: AttachmentsByMessage
  provider: Provider
  modelId: string
  /** Providers this user holds a key for, for the picker's disabled states. */
  configuredProviders: readonly Provider[]
  /** Shared-key messages left today, read on the server for this render. */
  remaining: number
  /** False while the global monthly ceiling is spent. Irrelevant to a BYOK model. */
  sharedKeyAvailable: boolean
  /** The conversation's standing instruction. Null on /chat and when unset. */
  systemPrompt: string | null
  /**
   * A message to scroll to on arrival, from a search result's `?m=`. Null on
   * every other entry to the page. (F27)
   */
  jumpToMessageId?: string | null
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
  initialAttachments,
  provider,
  modelId,
  configuredProviders,
  remaining,
  sharedKeyAvailable,
  systemPrompt: initialSystemPrompt,
  jumpToMessageId = null,
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

  /**
   * The thread's files, keyed by message id. (F29)
   *
   * Seeded from the server and then added to optimistically: on send, the entry
   * is keyed to the id the client just minted for its own copy of the message,
   * because that is the id the thread is rendering under. When the server
   * reports which row the prompt became, this map is re-keyed alongside the
   * message — the same move `adoptPersistedPromptId()` already makes, for the
   * same reason, which is why the two happen together.
   *
   * The URLs come from the confirm call rather than from object URLs held here,
   * so nothing in this component owns a resource it has to remember to revoke.
   */
  const [attachments, setAttachments] =
    useState<AttachmentsByMessage>(initialAttachments)

  const [model, setModel] = useState({ provider, modelId })
  const { changeModel, error: modelError } = useModelMutation()

  /**
   * The conversation's standing instruction, seeded from the row for the same
   * reason the model is: it changes without a navigation, and the row is the
   * source of truth on load. (F23)
   */
  const [systemPrompt, setSystemPromptState] = useState(initialSystemPrompt)
  const { setSystemPrompt, error: systemPromptError } = useConversationMutation()

  /**
   * Saves the prompt, and persists it only when there is a row to persist to.
   *
   * The `/chat` case mirrors the model exactly: no conversation exists yet, so
   * the value stays local and rides along in the request body, where
   * `createConversation()` writes it. The server honours a body prompt ONLY on
   * that creation path — for an existing conversation it reads the row — so the
   * local-first move here cannot turn into a per-request override.
   *
   * Returns false on a failed write so the dialog can stay open holding the
   * text. Unlike the model, the local state is NOT moved first: a system prompt
   * that appears to have saved and did not would silently change how every
   * later answer reads, and the composer would agree with a database that does
   * not.
   */
  async function saveSystemPrompt(next: string | null): Promise<boolean> {
    if (!conversationId) {
      setSystemPromptState(next)
      return true
    }

    if (!(await setSystemPrompt(conversationId, next))) return false

    setSystemPromptState(next)
    return true
  }

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
             * Only ever acted on when this request CREATES the conversation.
             * On `/chat` there is no row to have stored one, so this is the
             * only way a prompt chosen before the first message can reach the
             * server; for an existing conversation the route reads the row and
             * ignores this. Sent unconditionally rather than conditionally,
             * because a body that changes shape by route is a second rule.
             */
            systemPrompt,

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
    // conversation loaded with however many times the picker was used. The
    // system prompt is here for exactly that reason too — on `/chat` it is the
    // body that carries it, so a stale closure would create the conversation
    // with the prompt that was set before the user edited it.
    [conversationId, model.provider, model.modelId, systemPrompt],
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

      // The attachment map is keyed by message id, so it has to move with the
      // message. Missing this would leave a just-sent image rendering under an
      // id nothing in the thread has any more — the picture would simply vanish
      // the moment the answer finished. (F29)
      setAttachments((currentAttachments) => {
        const files = currentAttachments[prompt.id]
        if (!files) return currentAttachments

        const next = { ...currentAttachments, [persisted]: files }
        delete next[prompt.id]
        return next
      })

      const next = [...current]
      next[index] = { ...prompt, id: persisted }
      return next
    })
  }

  /**
   * Sends a message, with whatever the composer had attached to it. (F29)
   *
   * The id is minted here rather than left to the SDK, because the attachment
   * map is keyed by message id and the map has to be written *before* the
   * message exists on screen — otherwise the images appear a beat late, or not
   * until the answer finishes.
   *
   * **It is passed as a whole message object, not as `sendMessage`'s
   * `messageId` option**, and the difference was measured off the installed SDK
   * rather than assumed: `messageId` is strictly a *replace* primitive. It looks
   * up the id, **throws** when it is not already in the thread, and truncates
   * everything after it — which is exactly right for F19's edit and exactly
   * wrong here. The object form takes the other branch, where `id` is used as
   * given.
   *
   * `position` is overwritten with the chip order. A freshly confirmed row
   * carries the column default, so every optimistic attachment would otherwise
   * claim position 0 and the render order would rest on sort stability.
   */
  function send(text: string, files: readonly RenderedAttachment[]) {
    const messageId = crypto.randomUUID()

    if (files.length > 0) {
      setAttachments((current) => ({
        ...current,
        [messageId]: files.map((file, index) => ({ ...file, position: index })),
      }))
    }

    void sendMessage(
      { id: messageId, role: 'user', parts: [{ type: 'text', text }] },
      files.length > 0
        ? { body: { attachmentIds: files.map((file) => file.id) } }
        : undefined,
    )
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

  /**
   * Scrolls to the message a search result named, once. (F27)
   *
   * An effect rather than a render-time adjustment, because it reaches into the
   * DOM: the anchor has to exist before `jumpTo` can find it, which means after
   * the thread has painted. It runs on mount for the ordinary case — arriving
   * from `/search` remounts this component, since the conversation id changes —
   * and is keyed on the id so following a second result into the *same*
   * conversation still moves.
   *
   * The param is then stripped with `router.replace`. Two reasons: reloading
   * the page should not drag the reader back to a message they have scrolled
   * away from, and the URL in the address bar should describe where they are
   * rather than how they arrived. `replace` rather than `push` so Back returns
   * to the search results instead of to this same page without its parameter.
   */
  useEffect(() => {
    if (!jumpToMessageId) return

    // A frame, so the jump measures a thread that has actually painted.
    const frame = requestAnimationFrame(() => {
      jumpTo(jumpToMessageId)
      router.replace(`/chat/${conversationId}`, { scroll: false })
    })

    return () => cancelAnimationFrame(frame)
  }, [jumpToMessageId, conversationId, jumpTo, router])

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
            attachments={attachments}
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
        systemPrompt={systemPrompt}
        systemPromptError={systemPromptError}
        onSaveSystemPrompt={saveSystemPrompt}
        onSend={send}
        onStop={() => void stop()}
      />
    </div>
  )
}
