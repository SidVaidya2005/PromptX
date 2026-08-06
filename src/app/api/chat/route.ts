import { NextResponse } from 'next/server'

import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from 'ai'

import { STREAM_TIMEOUT_MS } from '@/lib/constants'
import { chatRequestSchema } from '@/lib/schemas'
import { toUIMessages } from '@/lib/messages'
import { textOf } from '@/lib/utils'

import { getUser } from '@/server/auth'
import {
  createConversation,
  deleteConversation,
  getConversation,
  touchConversation,
} from '@/server/data/conversations'
import {
  appendMessage,
  completeMessage,
  editMessageAndTruncate,
  failMessage,
  getMessage,
  listByConversation,
} from '@/server/data/messages'
import { MissingKeyError, resolveModel, UnknownModelError } from '@/server/providers'
import {
  BudgetExhaustedError,
  QuotaExceededError,
  recordSharedKeyTokens,
  releaseSharedSlot,
} from '@/server/quota'

/**
 * Documents intent. On Render every route is Node already, so nothing can
 * silently switch this to Edge and break `node:crypto` in the vault — which
 * resolveModel() now reaches on this path whenever the caller has a key of
 * their own.
 *
 * Naming the decrypting function here rather than describing it would fail
 * tests/security/key-exposure.test.ts, which greps src/app for the identifier
 * and cannot tell a comment from a call. That bluntness is deliberate and the
 * comment bends around it, not the other way round.
 */
export const runtime = 'nodejs'

/**
 * Sends a message and streams the answer back.
 *
 * Two orderings in here are doing real work.
 *
 * **Nothing is written until the request is certain to reach a provider.**
 * resolveModel() comes before the first insert, so a refusal — an unknown
 * model, a missing key, a spent daily allowance, a tripped breaker — leaves no
 * dangling prompt and no empty conversation. That is also why conversation
 * creation lives in this handler rather than its own endpoint.
 *
 * Feature 19 raised the stakes on that ordering rather than complicating it.
 * `editMessageId` turns this into an edit-and-resend, which DELETES every
 * message after the one it rewrites — so the same line that used to prevent a
 * dangling prompt now prevents a destroyed conversation. A refused edit leaves
 * the thread byte-for-byte as it was, which is only true because the truncation
 * sits below the line with every other write and not above it.
 *
 * **The assistant row is created up front in `streaming` status**, and its id is
 * held for the life of the stream. Without it there is no stable row to update
 * on failure: at that moment the newest message is the *user's*, so any
 * "mark the last message errored" logic would mark the prompt as failed.
 */
export async function POST(request: Request) {
  const user = await getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = chatRequestSchema.safeParse(await request.json())
  if (!parsed.success) {
    console.error('[api/chat] invalid request', parsed.error)
    return NextResponse.json(
      { error: 'Invalid request', code: 'invalid_input' },
      { status: 400 },
    )
  }

  const { conversationId, editMessageId, message, provider, modelId } = parsed.data

  const text = textOf(message)
  if (!text.trim()) {
    return NextResponse.json(
      { error: 'Invalid request', code: 'invalid_input' },
      { status: 400 },
    )
  }

  // There is nothing to edit in a conversation that does not exist yet, so this
  // pairing is incoherent rather than merely unauthorised.
  if (editMessageId && !conversationId) {
    return NextResponse.json(
      { error: 'Invalid request', code: 'invalid_input' },
      { status: 400 },
    )
  }

  // An existing conversation must be the caller's. RLS is what makes this
  // return null for someone else's row, so the 404 is a database guarantee
  // rather than a filter this handler remembered to write.
  if (conversationId) {
    const conversation = await getConversation(conversationId)
    if (!conversation) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
  }

  // Checked here, above the provider line, because it is a READ. The edit
  // itself must wait — it deletes messages — but proving the target exists and
  // is editable costs nothing and turns a bad id into a 404 before a quota slot
  // has been claimed for a request that was never going to work.
  if (editMessageId) {
    const target = await getMessage(editMessageId)

    if (!target || target.conversation_id !== conversationId || target.role !== 'user') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
  }

  let model
  let usedSharedKey
  try {
    ;({ model, usedSharedKey } = await resolveModel(user.id, provider, modelId))
  } catch (error) {
    if (error instanceof MissingKeyError) {
      return NextResponse.json(
        { error: `No API key configured for ${error.provider}`, code: 'missing_key' },
        { status: 400 },
      )
    }

    if (error instanceof BudgetExhaustedError) {
      // 503, not 429: nothing this person does changes the answer, so a status
      // meaning "you have had your share" would be wrong. Checked before the
      // reservation, so a refusal here has not touched their daily allowance
      // either — and like every refusal above it, nothing has been written.
      return NextResponse.json(
        { error: error.message, code: 'budget_exhausted' },
        { status: 503 },
      )
    }

    if (error instanceof QuotaExceededError) {
      // Before the generic arm below, or a refusal the application makes on
      // purpose would be reported as a fault it did not intend. Nothing was
      // written: resolveModel claims the slot before this handler persists
      // anything, so the thread is exactly as the user left it.
      return NextResponse.json(
        { error: error.message, code: 'quota_exceeded' },
        { status: 429 },
      )
    }

    if (error instanceof UnknownModelError) {
      // The error's own message, unlike the branch above — it already
      // distinguishes "no such model" from "PromptX ships none for this
      // provider yet", and rebuilding that distinction here would put the same
      // rule in two files. It names a provider and a model id the client just
      // sent us, so there is nothing in it that is not already theirs.
      return NextResponse.json(
        { error: error.message, code: 'unknown_model' },
        { status: 400 },
      )
    }

    console.error('[api/chat] could not resolve a model', error)
    return NextResponse.json(
      { error: 'Could not send message', code: 'internal_error' },
      { status: 500 },
    )
  }

  // ─────────── PAST THIS LINE THE REQUEST WILL REACH A PROVIDER ───────────
  // Everything above can refuse, and every refusal above leaves the database
  // exactly as it found it.

  let createdConversationId: string | null = null
  let targetId: string
  let assistantMessageId: string
  let history: UIMessage[]

  try {
    targetId =
      conversationId ?? (await createConversation(user.id, { provider, modelId }))
    if (!conversationId) createdConversationId = targetId

    if (editMessageId) {
      // The only destructive write in the application, and it is here rather
      // than earlier for the reason the line above states: everything that can
      // refuse has already run, so a spent allowance or a tripped breaker
      // cannot cost someone their thread. One round trip, because PostgREST
      // cannot span a transaction and an update that lands without its delete
      // leaves a prompt followed by the answer to a different question.
      const removed = await editMessageAndTruncate(editMessageId, text)

      // Null means the row stopped being editable between the check above and
      // this call. Nothing was written, so the throw lands in the catch below,
      // which refunds the slot.
      if (removed === null) {
        throw new Error(`message ${editMessageId} was not editable`)
      }

      // Re-read rather than truncating the earlier list in memory. The delete
      // predicate and listByConversation()'s ORDER BY are two halves of one
      // rule about what "after" means, and reconstructing the result here would
      // make this a third — free to disagree with both, and the disagreement
      // would show up as the model answering a question it was not asked.
      history = toUIMessages(await listByConversation(targetId))
    } else {
      // Loaded before the new row is written, then combined in memory.
      // Re-reading afterwards would cost a second round trip for the same
      // answer.
      const priorMessages = conversationId
        ? await listByConversation(conversationId)
        : []

      await appendMessage({
        conversationId: targetId,
        userId: user.id,
        role: 'user',
        content: text,
      })

      // The model must see the turn that was just written. Loading history and
      // passing it unchanged would send everything EXCEPT the message being
      // answered — the mistake architecture.md's example makes.
      history = [...toUIMessages(priorMessages), message as UIMessage]
    }

    assistantMessageId = await appendMessage({
      conversationId: targetId,
      userId: user.id,
      role: 'assistant',
      content: '',
      status: 'streaming',
      provider,
      modelId,
      usedSharedKey,
    })

    await touchConversation(targetId)
  } catch (error) {
    console.error('[api/chat] could not start the exchange', error)

    // The slot was claimed before any of this ran, and no generation is going
    // to happen now. The reconciliation sweep would eventually lower the count,
    // but it exists for a process that DIED — leaving a failure we can see to be
    // cleaned up by a job ten minutes later charges the user for the interval.
    if (usedSharedKey) await releaseSharedSlot(user.id)

    // PostgREST cannot span a transaction, so a conversation created a moment
    // ago can outlive the message that justified it.
    if (createdConversationId) {
      try {
        await deleteConversation(createdConversationId)
      } catch (cleanupError) {
        console.error('[api/chat] could not undo the new conversation', cleanupError)
      }
    }

    return NextResponse.json(
      { error: 'Could not send message', code: 'internal_error' },
      { status: 500 },
    )
  }

  /**
   * Every text delta as it goes past, so an interrupted answer is not lost.
   *
   * `onAbort` receives only `steps`, and a single-step generation stopped
   * mid-flight has no finished step in it — measured, not assumed: pressing
   * stop with 1,250 characters on screen persisted an empty row. Whatever is
   * on screen when someone stops has to survive a reload, so it is accumulated
   * here rather than asked for at the end.
   */
  let streamedText = ''

  const result = streamText({
    model,
    messages: await convertToModelMessages(history),
    onChunk: ({ chunk }) => {
      if (chunk.type === 'text-delta') streamedText += chunk.text
    },
    // Render will hold a request open for 100 minutes, so nothing in the
    // platform ends a hung provider connection. This is the only thing that
    // does. Composed with the request's own signal so pressing stop in the
    // browser actually stops generation rather than just hiding it.
    abortSignal: AbortSignal.any([
      AbortSignal.timeout(STREAM_TIMEOUT_MS),
      request.signal,
    ]),
    onEnd: async ({ text: answer, usage }) => {
      await completeMessage(assistantMessageId, {
        content: answer,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      })

      // The slot was claimed before the request went out; this only reconciles
      // what it actually cost. Accounting, never enforcement — nothing is ever
      // refused on the strength of these numbers.
      if (usedSharedKey) await recordSharedKeyTokens(user.id, usage)
    },
    onAbort: async () => {
      await failMessage(assistantMessageId, {
        content: streamedText,
        errorMessage: 'Generation stopped',
      })

      // Stopping is the user's decision, and they still did not get an answer.
      if (usedSharedKey) await releaseSharedSlot(user.id)
    },
    onError: async ({ error }) => {
      console.error('[api/chat] stream failed', error)
      // Keeps whatever arrived before the failure, for the same reason.
      await failMessage(assistantMessageId, {
        content: streamedText,
        errorMessage: 'The model could not finish this response.',
      })

      // A failed generation must not cost a message. Note this and onAbort can
      // both be reached for one request; the refund is floored at zero in SQL so
      // a double release cannot hand out a free message.
      if (usedSharedKey) await releaseSharedSlot(user.id)
    },
  })

  return createUIMessageStreamResponse({
    stream: createUIMessageStream({
      execute: ({ writer }) => {
        // A brand-new conversation has no URL yet. The id goes out ahead of the
        // first token as a transient part — transient so it never becomes a
        // message in the thread — and the client corrects the URL once the
        // response finishes.
        if (createdConversationId) {
          writer.write({
            type: 'data-conversation',
            data: { id: createdConversationId },
            transient: true,
          })
        }

        writer.merge(toUIMessageStream({ stream: result.stream }))
      },
    }),
  })
}
