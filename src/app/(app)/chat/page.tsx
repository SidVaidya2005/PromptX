import { SHARED_KEY_DAILY_MESSAGE_LIMIT, SHARED_MODEL_ID } from '@/lib/constants'

import { Composer } from '@/components/chat/Composer'

/**
 * The new-conversation page.
 *
 * No conversation row exists while this is on screen. It is created by the
 * first send, inside /api/chat, so arriving here and leaving again leaves
 * nothing behind.
 *
 * The model defaults to the shared Gemini key's, which is the only thing a user
 * without their own key can reach. Feature 15 puts a picker in the composer.
 */
export default function ChatPage() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-3xl">
        <p className="max-w-100 text-center text-body-md text-mute">
          Start a conversation. You have {SHARED_KEY_DAILY_MESSAGE_LIMIT} free messages a
          day before you need a key of your own.
        </p>
      </div>

      <Composer conversationId={null} provider="google" modelId={SHARED_MODEL_ID} />
    </div>
  )
}
