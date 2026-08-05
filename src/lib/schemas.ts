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
 * The body of `POST /api/chat`.
 *
 * `message` is singular and shaped like an AI SDK `UIMessage` on purpose. The
 * client sends only the newest turn — history is loaded server-side from the
 * database, so a client cannot rewrite its own past — and feature 08's
 * `prepareSendMessagesRequest` produces exactly this shape, so the transport
 * drops in without the schema moving.
 *
 * `conversationId` is nullable, which is where this diverges from the example
 * in `architecture.md`: null means "no conversation yet, create one". Creation
 * lives inside the chat route rather than a separate endpoint so that when
 * feature 16 refuses a request on quota, there is no half-made conversation
 * left behind.
 *
 * Every string is capped. An unbounded `z.string()` on a chat message is a
 * denial-of-service vector.
 */
export const chatRequestSchema = z.object({
  conversationId: z.uuid().nullable(),
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
  provider: providerSchema,
  modelId: z.string().min(1).max(120),
})

export type ChatRequest = z.infer<typeof chatRequestSchema>

/** The newest turn, as the client sends it. */
export type ChatRequestMessage = ChatRequest['message']

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
  apiKey: z
    .string()
    .min(PROVIDER_KEY_MIN_LENGTH)
    .max(PROVIDER_KEY_MAX_LENGTH),
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
