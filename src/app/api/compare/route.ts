import { NextResponse } from 'next/server'

import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  streamText,
  toUIMessageStream,
} from 'ai'

import { STREAM_TIMEOUT_MS } from '@/lib/constants'
import { compareRequestSchema } from '@/lib/schemas'

import { getUser } from '@/server/auth'
import { modelErrorPayload, resolveModel } from '@/server/providers'
import { recordSharedKeyTokens, releaseSharedSlot } from '@/server/quota'

/**
 * Documents intent, and matters here for the same reason it does on /api/chat:
 * resolveModel() reaches the vault whenever the caller has a key of their own,
 * and the vault needs `node:crypto`.
 */
export const runtime = 'nodejs'

/**
 * One prompt, one model, one answer that is never written down.
 *
 * **This route persists nothing.** No conversation, no messages, no attachments
 * — it imports no data module at all, which is the structural version of that
 * promise rather than a rule someone has to keep remembering. A comparison is
 * gone the moment the page is left, and feature 32's "Continue with this one" is
 * what turns one into something that lasts.
 *
 * **One request per column, not two columns per request.** §31 asked for two
 * `streamText` calls multiplexed into one response tagged `left` and `right`,
 * and asked in the same breath for independent stop controls and a per-column
 * error state — which one response cannot give. A single HTTP response carries a
 * single `request.signal`, so stopping one column would abort both or neither:
 * in practice neither, leaving the stop button hiding a response the provider
 * keeps generating and billing, which is precisely the failure F08 composed its
 * abort signal to prevent. And a refusal on one side could not be a status code,
 * so `quota_exceeded` would have to be smuggled into a 200 as a data part and
 * decoded by the client. Two requests give independent stop, independent
 * 400/429/503 and independent quota, and cost one extra round trip.
 *
 * The consequence worth stating: the server never hears the words `left` and
 * `right`. Which column a request belongs to is the client's business, and
 * nothing here can tell two comparisons apart from two ordinary generations.
 *
 * **The quota is charged as if it were a message, because it is one.** Two real
 * provider calls happen per comparison and someone pays for both. What is
 * unusual is only that they leave no `messages` row — so the slot is claimed
 * with `persisted: false`, which also lands it in `compare_count` where the
 * reconciliation sweep can see it. Without that the sweep, which reconciles
 * against `messages`, would hand every compare slot back within ten minutes and
 * the daily cap would not apply to this route at all.
 */
export async function POST(request: Request) {
  const user = await getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = compareRequestSchema.safeParse(await request.json())
  if (!parsed.success) {
    console.error('[api/compare] invalid request', parsed.error)
    return NextResponse.json(
      { error: 'Invalid request', code: 'invalid_input' },
      { status: 400 },
    )
  }

  const { prompt, provider, modelId } = parsed.data

  let model
  let usedSharedKey
  try {
    ;({ model, usedSharedKey } = await resolveModel(user.id, provider, modelId, {
      // The flag this whole route turns on. Everything below writes nothing, so
      // the sweep has no messages row to find and would refund the slot.
      persisted: false,
    }))
  } catch (error) {
    // The same mapping /api/chat answers with, read from one place. A column
    // whose model is refused shows its own message while the other keeps
    // streaming — which is only true because these are two requests.
    const refusal = modelErrorPayload(error)
    if (refusal) return NextResponse.json(refusal.body, { status: refusal.status })

    console.error('[api/compare] could not resolve a model', error)
    return NextResponse.json(
      { error: 'Could not run this comparison', code: 'internal_error' },
      { status: 500 },
    )
  }

  const result = streamText({
    model,
    // No system prompt. A comparison belongs to no conversation, so there is no
    // standing instruction to read — and honouring one from the body would be
    // the per-request override F23 refused to allow anywhere.
    // No id on the message, and the SDK's own type is what says so:
    // `convertToModelMessages` takes `Omit<UIMessage, 'id'>`. Fitting, since
    // nothing here ever names this message again — no row to adopt an id from,
    // no re-keying, no edit.
    messages: await convertToModelMessages([
      { role: 'user', parts: [{ type: 'text', text: prompt }] },
    ]),
    // Render will hold a request open for 100 minutes, so nothing in the
    // platform ends a hung provider connection. Composed with the request's own
    // signal, which is what makes this column's stop button real: aborting the
    // fetch ends the generation rather than hiding it.
    abortSignal: AbortSignal.any([
      AbortSignal.timeout(STREAM_TIMEOUT_MS),
      request.signal,
    ]),
    onEnd: async ({ usage }) => {
      // The only write this route makes, and it is a ledger rather than content.
      // The slot was claimed before the request went out; this reconciles what
      // it actually cost, on the same measured-usage-only terms as every other
      // caller.
      if (usedSharedKey) await recordSharedKeyTokens(user.id, usage)
    },
    onAbort: async () => {
      // Stopping one column is the user's decision, and they still did not get
      // an answer. `persisted` has to match the reserve call or compare_count is
      // left holding a slot message_count no longer has.
      if (usedSharedKey) await releaseSharedSlot(user.id, { persisted: false })
    },
    onError: async ({ error }) => {
      console.error('[api/compare] stream failed', error)

      // Note onAbort and onError can both be reached for one request; both
      // counters are floored at zero in SQL, so a double release cannot hand out
      // a free message.
      if (usedSharedKey) await releaseSharedSlot(user.id, { persisted: false })
    },
  })

  // Returned bare, unlike /api/chat's. That route wraps its stream in
  // createUIMessageStream to send back the ids of rows it created; this one
  // creates no rows, so there is nothing for the client to be told.
  return createUIMessageStreamResponse({
    stream: toUIMessageStream({ stream: result.stream }),
  })
}
