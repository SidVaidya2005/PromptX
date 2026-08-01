import { notFound } from 'next/navigation'

import { getConversation } from '@/server/data/conversations'
import { listByConversation } from '@/server/data/messages'

import { Composer } from '@/components/chat/Composer'
import { Thread } from '@/components/chat/Thread'

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
 *
 * The column owns its own scrolling — the shell's <main> is overflow-hidden —
 * so the composer stays pinned to the bottom while the thread scrolls behind it.
 */
export default async function ConversationPage({ params }: ConversationPageProps) {
  const { id } = await params

  const conversation = await getConversation(id)
  if (!conversation) notFound()

  const messages = await listByConversation(id)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Thread messages={messages} />
      </div>

      <Composer
        conversationId={conversation.id}
        provider={conversation.provider}
        modelId={conversation.model_id}
      />
    </div>
  )
}
