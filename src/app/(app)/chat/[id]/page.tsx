import { notFound } from 'next/navigation'

import { JUMP_TO_MESSAGE_PARAM, SHARED_KEY_DAILY_MESSAGE_LIMIT } from '@/lib/constants'
import { toUIMessages } from '@/lib/messages'

import { attachmentsByMessage } from '@/server/attachments'
import { getConversation } from '@/server/data/conversations'
import { listByConversation } from '@/server/data/messages'
import { listProviderKeys } from '@/server/data/provider-keys'
import { getTodaysUsage } from '@/server/data/shared-key-usage'
import { isSharedKeyAvailable } from '@/server/quota'

import { Chat } from '@/components/chat/Chat'

type ConversationPageProps = {
  params: Promise<{ id: string }>
  /**
   * Carries `?m=<messageId>` when the visitor arrived from a search result.
   * Both of these are Promises in Next 16.
   */
  searchParams: Promise<{ [JUMP_TO_MESSAGE_PARAM]?: string }>
}

/**
 * One conversation.
 *
 * `params` is a Promise and must be awaited — Next.js 16 removed the
 * synchronous fallback, so a missing await compiles cleanly and breaks at
 * runtime.
 *
 * getConversation returns null both when the id does not exist and when it
 * belongs to someone else, because RLS filters the row before this code sees
 * it. Both cases are a 404, which is the correct answer to each: confirming
 * that an id exists but is not yours is itself a disclosure.
 */
export default async function ConversationPage({
  params,
  searchParams,
}: ConversationPageProps) {
  const [{ id }, jumpParams] = await Promise.all([params, searchParams])

  const conversation = await getConversation(id)
  if (!conversation) notFound()

  // Concurrent: neither needs the other, and this page already costs one round
  // trip before it can know the conversation exists.
  const [messages, keys, used, sharedKeyAvailable] = await Promise.all([
    listByConversation(id),
    listProviderKeys(),
    getTodaysUsage(),
    isSharedKeyAvailable(),
  ])

  // After the thread, because it needs the message ids — one query and one
  // signing call for the whole conversation rather than either per message. (F29)
  const attachments = await attachmentsByMessage(messages)

  return (
    <Chat
      // Pins a remount to the conversation id. Measured as redundant today —
      // Next already remounts this segment on a param change, and removing this
      // line kept the picker correct across a client-side navigation between two
      // conversations on different models. It stays because what depends on that
      // behaviour is `Chat`'s model state, which is seeded from the row on mount
      // only: were the segment ever reused, the picker would show the previous
      // conversation's model and the next message would be billed to the
      // provider that model belongs to, with nothing on screen to say so.
      key={conversation.id}
      conversationId={conversation.id}
      initialMessages={toUIMessages(messages)}
      initialAttachments={attachments}
      provider={conversation.provider}
      modelId={conversation.model_id}
      configuredProviders={keys.map((key) => key.provider)}
      remaining={Math.max(SHARED_KEY_DAILY_MESSAGE_LIMIT - used, 0)}
      sharedKeyAvailable={sharedKeyAvailable}
      systemPrompt={conversation.system_prompt}
      // The thread header's two facts, read from the row. (F33)
      title={conversation.title}
      shareSlug={conversation.share_slug}
      // Set only when a search result was clicked. `Chat` scrolls to it once on
      // mount and then strips the param, so a reload does not send the reader
      // back to a message they have already scrolled away from. (F27)
      jumpToMessageId={jumpParams[JUMP_TO_MESSAGE_PARAM] ?? null}
    />
  )
}
