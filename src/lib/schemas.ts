/**
 * Schemas shared by the client and the server.
 *
 * Every route handler parses its body against one of these before touching it.
 * Secret validation does NOT live here — that is `src/server/env.ts`, which
 * carries `import 'server-only'` and can never reach a client bundle.
 */

import { z } from 'zod'

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
