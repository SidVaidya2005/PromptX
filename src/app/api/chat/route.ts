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
  linkAttachmentsToMessage,
  listAttachmentsByIds,
} from '@/server/data/attachments'
import {
  createConversation,
  deleteConversation,
  getConversation,
  touchConversation,
} from '@/server/data/conversations'
import {
  appendMessage,
  completeMessage,
  deleteMessage,
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
 * Feature 20 adds the third shape, `regenerate`, and it is the same
 * argument once more: replacing an answer deletes the old one, so that delete
 * belongs below the line with everything else destructive. What it does NOT do
 * is write a user message — the prompt is already stored, and a regeneration
 * that appended it again would leave the thread holding the same question
 * twice. That is the failure this branch exists to prevent, and it is invisible
 * from the screen: the client's view would look exactly right until a reload.
 *
 * Feature 28 adds no fourth shape — attachments are a modifier on a send — but
 * it splits across the same line one more time: whether every id is ready,
 * unlinked and the caller's is a read and belongs above it, while attaching them
 * to the row is a write and belongs below. Refusing an unfinished upload after
 * spending a daily message would be a refusal that costs something.
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

  const body = parsed.data
  const { conversationId, provider, modelId } = body

  // Narrowed by the presence of the field rather than by a discriminant tag.
  // The AI SDK decides which shape a request is — `trigger` is its word, sent
  // from `prepareSendMessagesRequest` — so a literal tag here would be the
  // client asserting something the body already says, and free to disagree
  // with it.
  if ('regenerate' in body) {
    // Nothing to regenerate in a conversation that does not exist yet. Same
    // incoherence as an edit without one, and the same answer.
    if (!conversationId) {
      return NextResponse.json(
        { error: 'Invalid request', code: 'invalid_input' },
        { status: 400 },
      )
    }
  } else {
    if (!textOf(body.message).trim()) {
      return NextResponse.json(
        { error: 'Invalid request', code: 'invalid_input' },
        { status: 400 },
      )
    }

    // There is nothing to edit in a conversation that does not exist yet, so
    // this pairing is incoherent rather than merely unauthorised.
    if (body.editMessageId && !conversationId) {
      return NextResponse.json(
        { error: 'Invalid request', code: 'invalid_input' },
        { status: 400 },
      )
    }

    // An edit rewrites a message that already exists, and its attachments are
    // whatever they were — there is no new row for a draft to be linked to.
    // Changing a sent message's files is a different feature and nothing in
    // §28–§30 asks for it, so the pairing is refused rather than half-honoured.
    if (body.editMessageId && body.attachmentIds?.length) {
      return NextResponse.json(
        { error: 'Invalid request', code: 'invalid_input' },
        { status: 400 },
      )
    }
  }

  // An existing conversation must be the caller's. RLS is what makes this
  // return null for someone else's row, so the 404 is a database guarantee
  // rather than a filter this handler remembered to write.
  /**
   * The stored standing instruction, and the *only* place a system prompt for
   * an existing conversation may come from. (F23)
   *
   * Null until proven otherwise, including for a conversation being created a
   * few lines below — there is no row to read yet, so that path takes the
   * body's prompt instead, and this one never does.
   */
  let systemPrompt: string | null = null

  if (conversationId) {
    const conversation = await getConversation(conversationId)
    if (!conversation) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    // Read from the row, never from `body.systemPrompt`. The body may carry one
    // — the composer sends it on every message, because on `/chat` that is the
    // only way it can arrive — and for an existing conversation it is ignored
    // here on purpose. Honouring it would make the field a per-request
    // override: one message answered under different standing instructions than
    // the conversation records, with nothing on screen or in the database to
    // say so. Whoever moves this line moves that guarantee with it.
    systemPrompt = conversation.system_prompt
  }

  /**
   * The thread, loaded once, above the line.
   *
   * Reads may live above it; only WRITES may not. The rule is about what a
   * refusal leaves behind, and a select leaves nothing — so hoisting this costs
   * no safety and lets the regenerate branch decide, before any slot is
   * claimed, whether the request was ever going to work.
   *
   * Not loaded for an edit. That path re-reads *after* truncating, for the
   * reason written where it does so, and a copy taken now would be the thread
   * as it was before the delete — the one thing it must not send to the model.
   */
  const isEdit = !('regenerate' in body) && Boolean(body.editMessageId)

  /** The assistant row a regeneration replaces, decided from the thread below. */
  let regenerateTargetId: string | null = null

  const priorMessages =
    conversationId && !isEdit ? await listByConversation(conversationId) : []

  // Checked here, above the provider line, because it is a READ — the same
  // split feature 19 uses. Proving the target is regenerable costs nothing and
  // turns a bad id into a 404 before a quota slot has been claimed for a
  // request that was never going to work. Only the delete has to wait.
  if ('regenerate' in body) {
    const last = priorMessages.at(-1)

    // WHICH message is not the client's to say — it names no id, because it
    // cannot reliably know one. What it asks for is "another answer to the
    // newest exchange", and the newest exchange is read from the database here.
    // An empty conversation, or one whose last row is a prompt with no answer,
    // has nothing to replace.
    if (!last || last.role !== 'assistant') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    // Held for the delete below. Read here rather than there so the two cannot
    // end up meaning different rows.
    regenerateTargetId = last.id
  } else if (body.editMessageId) {
    const target = await getMessage(body.editMessageId)

    if (!target || target.conversation_id !== conversationId || target.role !== 'user') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
  }

  /**
   * The files this turn will carry, checked here for the same reason the
   * regenerate target is: it is a READ, and reads may live above the line. (F28)
   *
   * Every refusal below leaves the thread exactly as the user left it, which is
   * the whole point of checking now — telling someone their upload had not
   * finished *after* spending one of their twenty daily messages would be a
   * refusal that costs something.
   *
   * The count is already bounded by `chatSendSchema`; what a schema cannot know
   * is whether each id is ready, unlinked and the caller's, and only the rows
   * answer that.
   */
  const attachmentIds = 'regenerate' in body ? [] : (body.attachmentIds ?? [])

  if (attachmentIds.length > 0) {
    // Duplicates would reach link_attachments_to_message as one row matching two
    // ordinalities, which updates it once and leaves the count short — a 500 for
    // what is really a malformed request. Refused here, where it can be named.
    if (new Set(attachmentIds).size !== attachmentIds.length) {
      return NextResponse.json(
        { error: 'Invalid request', code: 'invalid_input' },
        { status: 400 },
      )
    }

    const rows = await listAttachmentsByIds(attachmentIds)

    // A short read means an id was not the caller's — RLS filtered it out — or
    // never existed. Indistinguishable on purpose, as everywhere else here.
    if (rows.length !== attachmentIds.length) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    // §28: a 'pending' or 'failed' row is REPORTED, never silently dropped.
    // Sending the message without the file the person attached to it is the one
    // outcome that would look like the application working.
    if (rows.some((row) => row.status !== 'ready')) {
      return NextResponse.json(
        {
          error: "One of those files hasn't finished uploading.",
          code: 'attachment_not_ready',
        },
        { status: 400 },
      )
    }

    if (rows.some((row) => row.message_id !== null)) {
      return NextResponse.json(
        {
          error: 'One of those files has already been sent.',
          code: 'attachment_already_sent',
        },
        { status: 409 },
      )
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
  /** The row this turn's prompt became, sent back so the client can adopt it. */
  let promptMessageId: string | null = null
  let targetId: string
  let assistantMessageId: string
  let history: UIMessage[]

  try {
    if (conversationId) {
      targetId = conversationId
    } else {
      // The one moment the body's system prompt is authoritative: there is no
      // row to have stored one. A regeneration cannot reach here — it requires
      // an existing conversation — so the send branch is the only source.
      const requested = 'regenerate' in body ? null : (body.systemPrompt ?? null)

      targetId = await createConversation(user.id, { provider, modelId }, requested)
      createdConversationId = targetId
      systemPrompt = requested
    }

    if ('regenerate' in body) {
      // Destructive, so it waits for the line above like every other delete —
      // a spent allowance or a tripped breaker must not cost someone the answer
      // they already had. One statement, so it is atomic on its own and needs
      // no transaction: the row was proved to be the LAST message above, which
      // makes "everything after it" empty and leaves the (created_at, id) rule
      // with nothing to decide.
      // Non-null here by construction: the branch above sets it before any of
      // this runs, and returns 404 when it cannot. Checked rather than asserted,
      // because `code-standards.md` permits no `!` on a value that came in with
      // a request.
      if (!regenerateTargetId) {
        throw new Error('regenerate reached the write path with no target')
      }

      const removed = await deleteMessage(regenerateTargetId)

      // False means the row vanished between the check above and this call.
      // Nothing else was written, so the throw lands in the catch below, which
      // refunds the slot.
      if (!removed) {
        throw new Error(`message ${regenerateTargetId} was already gone`)
      }

      // Sliced rather than re-read, and this is safe for a reason the edit path
      // below cannot claim: exactly one row was deleted and it was proved to be
      // the last, so dropping the tail IS the post-delete thread. What the model
      // must see is the prompt; what it must not see is the answer being
      // replaced.
      //
      // No user message is appended here. The prompt is already a row — that is
      // the whole difference between regenerating and sending.
      history = toUIMessages(priorMessages.slice(0, -1))
    } else if (body.editMessageId) {
      // Destructive for the same reason, and more so: this one deletes every
      // message after the one it rewrites. One round trip, because PostgREST
      // cannot span a transaction and an update that lands without its delete
      // leaves a prompt followed by the answer to a different question.
      const removed = await editMessageAndTruncate(
        body.editMessageId,
        textOf(body.message),
      )

      // Null means the row stopped being editable between the check above and
      // this call. Nothing was written, so the throw lands in the catch below,
      // which refunds the slot.
      if (removed === null) {
        throw new Error(`message ${body.editMessageId} was not editable`)
      }

      // Re-read rather than truncating the earlier list in memory. The delete
      // predicate and listByConversation()'s ORDER BY are two halves of one
      // rule about what "after" means, and reconstructing the result here would
      // make this a third — free to disagree with both, and the disagreement
      // would show up as the model answering a question it was not asked.
      history = toUIMessages(await listByConversation(targetId))
    } else {
      // The id is kept, not discarded. The client minted its own for the copy
      // it is rendering, and that one names no row — so it is told which row
      // this turn actually became. See the write below the stream.
      promptMessageId = await appendMessage({
        conversationId: targetId,
        userId: user.id,
        role: 'user',
        content: textOf(body.message),
      })

      if (attachmentIds.length > 0) {
        // One statement, and it repeats the ready-and-unlinked conditions the
        // check above already made — deliberately. Between that check and this
        // call another request could have linked the same draft to a different
        // message, and a condition inside the write is the only kind that cannot
        // be raced. Same shape as F16's quota claim.
        const linked = await linkAttachmentsToMessage(promptMessageId, attachmentIds)

        // Fewer rows than ids means exactly that race, and a message showing two
        // of its four files is not a state anything downstream can repair. The
        // throw lands in the catch below, which refunds the shared slot.
        if (linked !== attachmentIds.length) {
          throw new Error(
            `linked ${linked} of ${attachmentIds.length} attachments to ${promptMessageId}`,
          )
        }
      }

      // The model must see the turn that was just written. Loading history and
      // passing it unchanged would send everything EXCEPT the message being
      // answered — the mistake architecture.md's example makes. `priorMessages`
      // was read above the line, before this insert, so it does not contain it.
      history = [...toUIMessages(priorMessages), body.message as UIMessage]
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
    // undefined rather than null when there is none: `system: null` would be a
    // value handed to the provider, and the schema collapses '' to null for the
    // same reason. (F23)
    system: systemPrompt ?? undefined,
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

        /**
         * Which row the prompt became.
         *
         * The client mints an id for the message it optimistically renders, and
         * that id names nothing in the database — so anything later that has to
         * point at this turn (feature 19's edit) would be pointing at a string
         * the server has never seen. It was: an edit of a message sent in the
         * same page session sent an SDK id where a uuid was required and was
         * refused. Reported the same way the conversation id already is, and
         * transient for the same reason — it corrects client state and must
         * never become a message in the thread.
         *
         * Only on a plain send. An edit rewrites a row that already has an id
         * the client knows, and a regeneration writes no prompt at all.
         */
        if (promptMessageId) {
          writer.write({
            type: 'data-prompt-message',
            data: { id: promptMessageId },
            transient: true,
          })
        }

        writer.merge(toUIMessageStream({ stream: result.stream }))
      },
    }),
  })
}
