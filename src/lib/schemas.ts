/**
 * Schemas shared by the client and the server.
 *
 * Every route handler parses its body against one of these before touching it.
 * Secret validation does NOT live here — that is `src/server/env.ts`, which
 * carries `import 'server-only'` and can never reach a client bundle.
 */

import { z } from 'zod'

import {
  ALLOWED_ATTACHMENT_MIME_TYPES,
  ATTACHMENT_INLINE_MAX_PX,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_PROMPT_BODY_LENGTH,
  MAX_PROMPT_TAG_LENGTH,
  MAX_PROMPT_TAGS,
  MAX_PROMPT_TITLE_LENGTH,
  MAX_SYSTEM_PROMPT_LENGTH,
  MAX_TITLE_LENGTH,
  PROVIDER_KEY_LABEL_MAX_LENGTH,
  PROVIDER_KEY_MAX_LENGTH,
  PROVIDER_KEY_MIN_LENGTH,
} from '@/lib/constants'

/**
 * A system prompt as it arrives from a client, or its absence. (F23)
 *
 * Shared by the two routes that can carry one, so "what a system prompt is"
 * has a single definition — the F15 rule about a rule two runtimes enforce,
 * applied to a shape rather than a predicate.
 *
 * **Empty normalises to null rather than being rejected**, and the transform is
 * what makes null the only spelling of "no prompt". Clearing the textarea is
 * the obvious way to remove one, and a schema that refused it would push the
 * translation into two clients that could then disagree; storing `''` would be
 * worse still, because the route sends `system: undefined` for null and an
 * empty string is a *value* the provider would be handed.
 *
 * `.trim()` is declared before `.max()` for the reason F21 measured on this
 * same zod version: checks run in declaration order, so the cap sees the
 * trimmed length and a pasted prompt is not rejected for its whitespace.
 */
const systemPromptValue = z
  .string()
  .trim()
  .max(MAX_SYSTEM_PROMPT_LENGTH)
  .transform((value) => (value === '' ? null : value))
  .nullable()

/** Mirrors the `provider` Postgres enum. */
export const providerSchema = z.enum(['openai', 'anthropic', 'google', 'openrouter'])

/**
 * The body of `POST /api/attachments`. (F28)
 *
 * Everything here is a *claim* about a file that has not been uploaded yet, and
 * that is worth being explicit about, because it decides what these checks are
 * worth. The upload goes client-direct to Storage through a signed URL, so
 * nothing the application does at this moment constrains what actually lands —
 * the bucket's own `file_size_limit` and `allowed_mime_types` are what enforce
 * that, and `/api/attachments/[id]/confirm` is what finds out afterwards.
 *
 * So why check at all: refusing a 40 MB PDF here means no row, no signed URL,
 * and an immediate answer, rather than a wasted upload that Storage rejects at
 * the last byte.
 *
 * `withDerivatives` is the client reporting whether it managed to produce the
 * two webp sizes. It may be false for an image — an older browser, a decode
 * failure — and that is a supported outcome, not an error: both columns stay
 * null and the renderer falls back to the original. It may never be true for a
 * PDF, which has nothing to derive from, and the refine below is what keeps a
 * client from asking for two signed URLs it could only fill with something
 * other than what it claimed.
 */
export const createAttachmentSchema = z
  .object({
    mimeType: z.enum(ALLOWED_ATTACHMENT_MIME_TYPES),
    sizeBytes: z.int().positive().max(MAX_ATTACHMENT_BYTES),
    withDerivatives: z.boolean(),
    /**
     * The inline derivative's pixel size, so `next/image` can carry explicit
     * dimensions and a thread of images does not reflow as it loads. (F29)
     *
     * **The one thing a client is trusted to report about its own upload**, and
     * the exemption is deliberate rather than an oversight: the browser decoded
     * the image to produce the derivative, and the server would have to decode
     * it again on the request path to check — the exact work the whole pipeline
     * exists to avoid. It is safe because these are cosmetic. A wrong value
     * costs a layout wobble; a wrong `sizeBytes` or `mimeType` would be a
     * security claim, which is why those two are measured at confirm instead.
     *
     * Bounded by the derivative's own cap anyway, so a nonsense figure is
     * refused rather than stored.
     */
    inlineWidth: z.int().positive().max(ATTACHMENT_INLINE_MAX_PX).optional(),
    inlineHeight: z.int().positive().max(ATTACHMENT_INLINE_MAX_PX).optional(),
  })
  .strict()
  .refine((value) => !(value.withDerivatives && value.mimeType === 'application/pdf'), {
    message: 'A PDF has no derivatives',
    path: ['withDerivatives'],
  })

export type CreateAttachmentInput = z.infer<typeof createAttachmentSchema>

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
    /**
     * The system prompt for a conversation that does not exist yet. (F23)
     *
     * On `/chat` there is no row to PATCH, so the composer's prompt rides along
     * with the first message and `createConversation()` stores it — the same
     * arrangement the model already has.
     *
     * **The route honours this only when it is creating the conversation.** For
     * an existing `conversationId` the stored prompt is read from the row and
     * this field is ignored, which is what stops it becoming a per-request
     * override: otherwise any client could send one message under different
     * standing instructions than the conversation records, and nothing on
     * screen or in the database would say so.
     *
     * Optional here, unlike on the PATCH branch, because absence and null mean
     * the same thing on a conversation that has no prompt yet.
     */
    systemPrompt: systemPromptValue.optional(),
    /**
     * Ready drafts to attach to this turn, in the order they should render. (F28)
     *
     * The cap is here as well as in the route's own checks, and the two are not
     * a duplicated rule: this one bounds what is *parsed*, so an array of ten
     * thousand ids is refused before anything reads the database. What the route
     * cannot delegate to a schema is whether each id is ready, unlinked and the
     * caller's, which only the rows can answer.
     *
     * Order is the array's order. `link_attachments_to_message` assigns
     * `position` from it, so this is the only place a client says how its
     * attachments are arranged — a draft carries no position of its own,
     * because the composer can still reorder it right up to the send.
     *
     * On the send branch alone. A regeneration attaches nothing (the prompt and
     * its files already exist), and editing a message does not change its
     * attachments — that would be a different feature, and one nothing in
     * §28–§30 asks for.
     */
    attachmentIds: z.array(z.uuid()).max(MAX_ATTACHMENTS_PER_MESSAGE).optional(),
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
 * Pointing a conversation at a different model. (F15)
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
export const updateConversationModelSchema = z
  .object({
    provider: providerSchema,
    modelId: z.string().min(1).max(120),
  })
  .strict()

export type UpdateConversationModelInput = z.infer<typeof updateConversationModelSchema>

/**
 * Giving a conversation a name the user chose. (F21)
 *
 * **The check order is load-bearing, and it was measured rather than assumed.**
 * On zod 4.4.3 checks run in declaration order, so `.trim()` first means the
 * length bounds see the trimmed value: `'   '` fails `.min(1)` instead of
 * passing it and being stored as `''`, and a 60-character title survives the
 * padding a paste brought with it. Reversed, both of those go the other way.
 *
 * The server is authoritative about the whitespace. A client that trims too is
 * being convenient, never the guard.
 *
 * `normalizeTitle()` is deliberately not applied here. That function exists to
 * clean up what a *model* returned; stripping quotation marks a person typed on
 * purpose would be wrong.
 */
export const conversationRenameSchema = z
  .object({
    title: z.string().trim().min(1).max(MAX_TITLE_LENGTH),
  })
  .strict()

/**
 * Lifting a conversation out of the recency ordering, or letting it back in. (F21)
 *
 * Desired state, never a delta. `{pinned: true}` means "end up pinned", so a
 * retry, a double-click, and a resent request all land in the same place — where
 * a toggle would undo itself. That the column is a timestamp rather than a
 * boolean is a server-side detail: only its nullness is read today, and the type
 * leaves "most recently pinned first" available later.
 */
export const conversationPinSchema = z
  .object({
    pinned: z.boolean(),
  })
  .strict()

/**
 * Putting a conversation away, or taking it back out. (F22)
 *
 * Desired state for the same reason the pin is. Note what this schema does
 * *not* carry: archiving is only ever "hide this from the default sidebar", so
 * there is nothing here about the pin, the title, or the messages — an archived
 * conversation is unchanged in every respect except which query returns it.
 */
export const conversationArchiveSchema = z
  .object({
    archived: z.boolean(),
  })
  .strict()

/**
 * Setting or clearing a conversation's standing instruction. (F23)
 *
 * Explicitly nullable rather than optional, and the difference is the feature:
 * `{systemPrompt: null}` is how a prompt is *cleared*, so the key being absent
 * and the key being null have to mean different things. An optional field would
 * make "leave it alone" and "remove it" the same request.
 */
export const conversationSystemPromptSchema = z
  .object({
    systemPrompt: systemPromptValue,
  })
  .strict()

/**
 * The body of `PATCH /api/conversations/[id]` — one intent at a time.
 *
 * **Every branch is `.strict()`, for the reason `chatRequestSchema` records.**
 * `z.union` tries branches in order and an ordinary zod object *strips* keys it
 * does not declare, so a body carrying both `title` and `pinned` would match the
 * rename branch, lose the pin on the floor, and be answered as though only a
 * rename had been asked for. Strict makes that body match nothing and fail
 * loudly. Feature 22's archive arrived as the fourth branch, as expected.
 *
 * The route narrows with `'title' in parsed.data` and so on, which TypeScript
 * resolves without an assertion.
 */
export const updateConversationSchema = z.union([
  updateConversationModelSchema,
  conversationRenameSchema,
  conversationPinSchema,
  conversationArchiveSchema,
  conversationSystemPromptSchema,
])

export type UpdateConversationInput = z.infer<typeof updateConversationSchema>

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
 * The tags on a saved prompt, as they arrive and as they are stored. (F24)
 *
 * `build-plan.md` §24 asks for tags "normalised to lowercase and deduplicated on
 * save", and this is the only place that happens — the chip input in the dialog
 * is convenience, never the guard, the same division `conversationRenameSchema`
 * makes about whitespace.
 *
 * **The order of these five lines is the whole schema.** Element checks run
 * first, so each tag is trimmed and lowercased before anything looks at it; then
 * the array-level checks run in declaration order, which F21 measured on this
 * same zod version. `.overwrite()` is what makes that possible — unlike
 * `.transform()`, it preserves the schema type, so `.max()` can still be chained
 * after it and therefore counts the **deduplicated** tags. Reversed, `['api',
 * 'API', 'api ']` would be three tags against the cap and one in the database.
 *
 * The two caps are not a duplicate. The first bounds what is *parsed* — an
 * unbounded array is the denial-of-service vector an unbounded string is, and
 * capping only the elements does not bound the whole. The second is the product
 * rule: eight distinct tags on one prompt.
 */
const promptTagsSchema = z
  .array(z.string().trim().toLowerCase().max(MAX_PROMPT_TAG_LENGTH))
  .max(MAX_PROMPT_TAGS * 4)
  // Empties are dropped rather than rejected: a stray separator is an authoring
  // slip, not something worth failing a whole save over.
  .overwrite((tags) => [...new Set(tags.filter((tag) => tag !== ''))])
  .max(MAX_PROMPT_TAGS)

/**
 * The body of `POST /api/prompts`. (F24)
 *
 * `.trim()` before the length checks on both strings, for the reason F21
 * measured: checks run in declaration order, so trim-first rejects `'   '` at
 * `.min(1)` instead of storing `''`, and a pasted prompt is not rejected for
 * whitespace it brought with it.
 *
 * `tags` is optional and defaults to empty, matching the column default. A
 * prompt with no tags is the ordinary case, and requiring the key would make
 * every caller send `[]` to say nothing.
 */
export const createPromptSchema = z
  .object({
    title: z.string().trim().min(1).max(MAX_PROMPT_TITLE_LENGTH),
    body: z.string().trim().min(1).max(MAX_PROMPT_BODY_LENGTH),
    tags: promptTagsSchema.optional().default([]),
  })
  .strict()

export type CreatePromptInput = z.infer<typeof createPromptSchema>

/**
 * The body of `PATCH /api/prompts/[id]`. (F24)
 *
 * Deliberately **not** a union of strict branches, which is the shape
 * `updateConversationSchema` has and the one this codebase reaches for by habit.
 * That union exists because five genuinely separate intents — model, rename,
 * pin, archive, system prompt — converge on one row and must not be confusable.
 * A prompt has one intent: the dialog edits title, body and tags together and
 * submits all three, so partial branches would be machinery with no caller and a
 * second way to express "save this prompt" that nothing sends.
 *
 * Still `.strict()`, for the reason every schema here is: an ordinary zod object
 * strips undeclared keys, so a body carrying a stray field would be answered as
 * though it had been understood.
 */
export const updatePromptSchema = createPromptSchema

export type UpdatePromptInput = z.infer<typeof updatePromptSchema>

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
