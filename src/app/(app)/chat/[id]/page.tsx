import { notFound } from 'next/navigation'

import { toUIMessages } from '@/lib/messages'

import { getConversation } from '@/server/data/conversations'
import { listByConversation } from '@/server/data/messages'

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

  const messages = await listByConversation(id)

  return (
    <Chat
      conversationId={conversation.id}
      initialMessages={toUIMessages(messages)}
      provider={conversation.provider}
      modelId={conversation.model_id}
    />
  )
}
