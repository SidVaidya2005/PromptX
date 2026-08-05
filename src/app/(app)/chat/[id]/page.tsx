import { notFound } from 'next/navigation'

import { SHARED_KEY_DAILY_MESSAGE_LIMIT } from '@/lib/constants'
import { toUIMessages } from '@/lib/messages'

import { getConversation } from '@/server/data/conversations'
import { listByConversation } from '@/server/data/messages'
import { listProviderKeys } from '@/server/data/provider-keys'
import { getTodaysUsage } from '@/server/data/shared-key-usage'

import { Chat } from '@/components/chat/Chat'

type ConversationPageProps = {
  params: Promise<{ id: string }>
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
export default async function ConversationPage({ params }: ConversationPageProps) {
  const { id } = await params

  const conversation = await getConversation(id)
  if (!conversation) notFound()

  // Concurrent: neither needs the other, and this page already costs one round
  // trip before it can know the conversation exists.
  const [messages, keys, used] = await Promise.all([
    listByConversation(id),
    listProviderKeys(),
    getTodaysUsage(),
  ])

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
      provider={conversation.provider}
      modelId={conversation.model_id}
      configuredProviders={keys.map((key) => key.provider)}
      remaining={Math.max(SHARED_KEY_DAILY_MESSAGE_LIMIT - used, 0)}
    />
  )
}
