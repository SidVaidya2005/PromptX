import { SHARED_KEY_DAILY_MESSAGE_LIMIT, SHARED_MODEL_ID } from '@/lib/constants'

import { Chat } from '@/components/chat/Chat'

/**
 * The new-conversation page.
 *
 * No conversation row exists while this is on screen. It is created by the
 * first send, inside /api/chat, so arriving here and leaving again leaves
 * nothing behind — and the URL only becomes /chat/[id] once the server has
 * confirmed which id that is.
 *
 * The model defaults to the shared Gemini key's, which is the only thing a user
 * without their own key can reach. Feature 15 puts a picker in the composer.
 */
export default function ChatPage() {
  return (
    <Chat
      conversationId={null}
      initialMessages={[]}
      provider="google"
      modelId={SHARED_MODEL_ID}
      emptyState={
        <div className="flex h-full items-center justify-center p-3xl">
          <p className="max-w-100 text-center text-body-md text-mute">
            Start a conversation. You have {SHARED_KEY_DAILY_MESSAGE_LIMIT} free messages
            a day before you need a key of your own.
          </p>
        </div>
      }
    />
  )
}
