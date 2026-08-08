import { NextResponse } from 'next/server'

import { findModel } from '@/lib/models'
import { promoteComparisonSchema } from '@/lib/schemas'

import { getUser } from '@/server/auth'
import { createConversation, deleteConversation } from '@/server/data/conversations'
import { appendMessage } from '@/server/data/messages'
import { UnknownModelError } from '@/server/providers'

/** Documents intent. Nothing here reaches the vault, but every route is Node. */
export const runtime = 'nodejs'

/**
 * Turns one column of a comparison into a real conversation. (F32)
 *
 * **This route writes and never generates.** It is the only write path in the
 * application that does not resolve a model first, and the omission is the
 * feature rather than an oversight: `resolveModel()` exists to decide which key
 * pays and to claim a slot before spending it, and nothing here spends anything.
 * The answer has already been generated and paid for — by the comparison that
 * produced it, which claimed its slot in F31 and reconciled its tokens there.
 *
 * **It is also the one place a client's assistant text is accepted**, and that
 * is a narrowing of a stated invariant rather than a hole in it. The rule is
 * that history never comes from the request body, and it exists so a client
 * cannot steer a completion with a fabricated past. There is no completion here
 * to steer. The consequence is real and accepted: a crafted body can store an
 * assistant turn no model produced, in the caller's own conversation, and F33
 * will publish it to anyone with the link. That is the price of a compare view
 * that persists nothing — the alternative was keeping every comparison
 * server-side, or regenerating on promotion and handing back a different answer
 * than the one the user picked.
 *
 * Any other route that grows a field like `answer` is a bug. One that accepts it
 * *and* calls a provider breaks the invariant outright.
 */
export async function POST(request: Request) {
  const user = await getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = promoteComparisonSchema.safeParse(await request.json())
  if (!parsed.success) {
    console.error('[api/compare/promote] invalid request', parsed.error)
    return NextResponse.json(
      { error: 'Invalid request', code: 'invalid_input' },
      { status: 400 },
    )
  }

  const { prompt, answer, provider, modelId } = parsed.data

  /**
   * The catalog is still an enforcement boundary here, even with no provider
   * call to protect. (F14)
   *
   * A conversation stores the model its next message will use, so writing one
   * this application would refuse leaves a thread that cannot be replied to
   * until somebody changes the picker back — a dead end created by a click that
   * looked like it worked. The error is `UnknownModelError`'s own, because it
   * already distinguishes "no such model" from "PromptX ships none for this
   * provider yet".
   */
  if (!findModel(provider, modelId)) {
    const error = new UnknownModelError(provider, modelId)
    return NextResponse.json({ error: error.message, code: 'unknown_model' }, { status: 400 })
  }

  let conversationId: string | null = null

  try {
    // No system prompt: a comparison belongs to no conversation and inherits no
    // standing instruction. Null is the value getConversation() reads back as
    // "use the provider's default", which is what the comparison itself ran
    // under. (F23)
    conversationId = await createConversation(user.id, { provider, modelId }, null)

    await appendMessage({
      conversationId,
      userId: user.id,
      role: 'user',
      content: prompt,
    })

    await appendMessage({
      conversationId,
      userId: user.id,
      role: 'assistant',
      content: answer,
      status: 'complete',
      // Recorded as the client claims, having been checked against the catalog
      // above. Once the answer text is trusted the label on it costs no further
      // trust — and writing null would break "every assistant message records
      // the provider and model that produced it" for every promoted thread.
      provider,
      modelId,
      /**
       * **False even when the shared key really did produce this**, and it is
       * arithmetic rather than bookkeeping.
       *
       * The reconciliation sweep computes
       * `actual = count(complete shared assistant messages) + compare_count`,
       * and F31 already recorded this generation in `compare_count`. Marking the
       * row true counts one spend twice, raising the floor the sweep compares
       * against — and because the sweep only ever *lowers*, an inflated floor
       * silently blocks a legitimate refund: after one comparison and one
       * promotion, a genuinely orphaned chat slot later that day would never come
       * back, and the user would be charged for a generation they never
       * received.
       *
       * `compare_count` is the single record of what a comparison cost. This row
       * is a copy of its output, not a second claim on the allowance.
       */
      usedSharedKey: false,
    })
  } catch (error) {
    console.error('[api/compare/promote] could not promote the comparison', error)

    // PostgREST cannot span a transaction, so a conversation created a moment
    // ago can outlive the messages that justified it. Without this a failed
    // promotion leaves an empty 'New chat' in the sidebar — the same cleanup
    // /api/chat carries, for the same reason.
    if (conversationId) {
      try {
        await deleteConversation(conversationId)
      } catch (cleanupError) {
        console.error('[api/compare/promote] could not undo the conversation', cleanupError)
      }
    }

    return NextResponse.json(
      { error: 'Could not continue this comparison', code: 'internal_error' },
      { status: 500 },
    )
  }

  // `touchConversation()` is deliberately not called. The row's `updated_at`
  // defaults to now() and both messages land milliseconds later, so the sidebar
  // already orders it as the newest activity.
  return NextResponse.json({ conversationId }, { status: 201 })
}
