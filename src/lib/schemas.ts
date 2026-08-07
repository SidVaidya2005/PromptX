/**
 * Schemas shared by the client and the server.
 *
 * Every route handler parses its body against one of these before touching it.
 * Secret validation does NOT live here — that is `src/server/env.ts`, which
 * carries `import 'server-only'` and can never reach a client bundle.
 */

import { z } from 'zod'

import {
  PROVIDER_KEY_LABEL_MAX_LENGTH,
  PROVIDER_KEY_MAX_LENGTH,
  PROVIDER_KEY_MIN_LENGTH,
} from '@/lib/constants'

/** Mirrors the `provider` Postgres enum. */
export const providerSchema = z.enum(['openai', 'anthropic', 'google', 'openrouter'])

/**
 * What every `POST /api/chat` body carries, whichever kind it is.
 *
 * `conversationId` is nullable, which is where this diverges from the example
 * in `architecture.md`: null means "no conversation yet, create one". Creation
 * lives inside the chat route rather than a separate endpoint so that when
 * feature 16 refuses a request on quota, there is no half-made conversation
 * left behind.
 *
 * `provider` and `modelId` are here rather than on the send branch because a
 * regeneration may name a *different* model from the conversation's own, and
 * that model is recorded on the new assistant message alone. (F20)
 */
const chatRequestBase = z.object({
  conversationId: z.uuid().nullable(),
  provider: providerSchema,
  modelId: z.string().min(1).max(120),
})

/**
 * A new turn: the user typed something, or rewrote something they had typed.
 *
 * `message` is singular and shaped like an AI SDK `UIMessage` on purpose. The
 * client sends only the newest turn — history is loaded server-side from the
 * database, so a client cannot rewrite its own past — and feature 08's
 * `prepareSendMessagesRequest` produces exactly this shape, so the transport
 * drops in without the schema moving.
 *
 * `editMessageId` is feature 19, and it lives on this schema rather than on a
 * route of its own for a reason that is really about ordering. An edit deletes
 * every message after the one it rewrites, and this handler is the only place
 * that knows whether a request is going to reach a provider at all. A separate
 * `PATCH /api/messages/[id]` would put that delete on the far side of the
 * refusal path — truncate succeeds, the send is then refused on quota, and the
 * thread is destroyed with no answer and nothing to restore it from. Same
 * argument that put conversation creation here at F07, with more at stake.
 *
 * Every string is capped. An unbounded `z.string()` on a chat message is a
 * denial-of-service vector.
 */
export const chatSendSchema = chatRequestBase
  .extend({
    /** Non-null turns this into an edit-and-resend of an existing user message. */
    editMessageId: z.uuid().nullish(),
    message: z.object({
      id: z.string().min(1).max(64),
      role: z.literal('user'),
      parts: z
        .array(
          z.object({
            type: z.literal('text'),
            text: z.string().min(1).max(100_000),
          }),
        )
        .min(1),
    }),
  })
  .strict()

/**
 * A second answer to a prompt that has already been sent. (F20)
 *
 * Carries no `message`, and that absence is the whole point: regenerating does
 * not re-send the prompt, so there is no text here for a client to alter on the
 * way past. The prompt stays exactly the row the database already holds — which
 * is what distinguishes this from an edit whose text happens not to have
 * changed.
 *
 * **It also carries no message id, and that absence was learned rather than
 * designed.** The first version named the assistant row being replaced, on the
 * reasoning that the AI SDK hands `prepareSendMessagesRequest` a `messageId` for
 * free. It does — but that id is only a *database* id when the message came from
 * the server. A message that has just streamed carries an id the SDK generated,
 * so the second consecutive regeneration in one page session sent something like
 * `a6i8GltgJ1K7KZtE` and was refused as a malformed uuid. Observed, not
 * predicted: the first regeneration worked and the next returned 400.
 *
 * The id was never load-bearing anyway. The route requires the target to be the
 * *last* message in the conversation, which it reads from the database — so the
 * id could only ever agree or disagree with something already known, and a
 * consistency check the client structurally cannot satisfy is worse than none.
 * A flag says the same thing without pretending to identify a row.
 */
export const chatRegenerateSchema = chatRequestBase
  .extend({
    regenerate: z.literal(true),
  })
  .strict()

/**
 * The body of `POST /api/chat` — one of the two shapes above.
 *
 * **Both branches are `.strict()`, and that is load-bearing rather than
 * tidiness.** `z.union` tries branches in order and an ordinary zod object
 * *strips* keys it does not declare. Without `.strict()`, a body carrying both
 * `message` and `regenerate` would match the send branch, lose the flag on the
 * floor, and be handled as a perfectly ordinary send — so a regeneration would
 * append the prompt a second time while the screen showed the right thing.
 * Strict makes that body match neither branch and fail loudly.
 *
 * The route narrows on `'regenerate' in parsed.data`, which TypeScript resolves
 * without an assertion — `code-standards.md` permits no `!` on values derived
 * from a request body.
 */
export const chatRequestSchema = z.union([chatSendSchema, chatRegenerateSchema])

export type ChatRequest = z.infer<typeof chatRequestSchema>

/** The newest turn, as the client sends it. Absent from a regeneration. */
export type ChatRequestMessage = z.infer<typeof chatSendSchema>['message']

/**
 * The body of `POST /api/title`.
 *
 * Not nullable, unlike the chat route's: titling names a conversation that
 * already exists and has already been answered once. There is nothing here for
 * the model to be told — what to title from is read server-side from the thread,
 * for the same reason history is, so a client cannot choose the words its own
 * conversation is named after.
 */
export const titleRequestSchema = z.object({
  conversationId: z.uuid(),
})

export type TitleRequest = z.infer<typeof titleRequestSchema>

/**
 * The body of `PATCH /api/conversations/[id]`.
 *
 * Deliberately the same two fields, with the same bounds, as `chatRequestSchema`
 * carries — a model reaches the server through exactly these two routes, and
 * describing it differently in each would be the first step towards them
 * disagreeing.
 *
 * This proves the id is a plausible string, not that it is a model. Catalog
 * membership is `findModel()`'s answer and the route asks it separately, for the
 * reason written on that function: a schema that also knew the catalog would be
 * a second copy of the rule.
 */
export const updateConversationModelSchema = z.object({
  provider: providerSchema,
  modelId: z.string().min(1).max(120),
})

export type UpdateConversationModelInput = z.infer<typeof updateConversationModelSchema>

/**
 * The body of `POST /api/keys`.
 *
 * `apiKey` is bounded on both ends, and neither bound is validation — the probe
 * in `src/server/keys.ts` is what decides whether a key is real. The cap is the
 * denial-of-service guard every string field here carries; the floor rejects an
 * empty or obviously truncated paste without spending a network round trip on
 * it.
 *
 * A parse failure on this route must never echo the submitted values back, the
 * way a zod error detail would. The route returns a bare `invalid_input` and
 * logs the detail server-side — reflecting an API key in a 400 response body
 * would defeat the point of the whole feature.
 */
export const createKeySchema = z.object({
  provider: providerSchema,
  apiKey: z.string().min(PROVIDER_KEY_MIN_LENGTH).max(PROVIDER_KEY_MAX_LENGTH),
  label: z.string().max(PROVIDER_KEY_LABEL_MAX_LENGTH).optional(),
})

export type CreateKeyInput = z.infer<typeof createKeySchema>

/**
 * The query of `DELETE /api/keys?provider=…`.
 *
 * A query parameter rather than a body: `build-plan.md` puts both verbs in one
 * `route.ts`, and a body on DELETE is legal but poorly supported by enough
 * intermediaries to be worth avoiding for a single enum value.
 */
export const deleteKeySchema = z.object({
  provider: providerSchema,
})
