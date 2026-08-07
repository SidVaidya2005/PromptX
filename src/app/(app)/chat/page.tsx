import { SHARED_KEY_DAILY_MESSAGE_LIMIT, SHARED_MODEL_ID } from '@/lib/constants'

import { listProviderKeys } from '@/server/data/provider-keys'
import { getTodaysUsage } from '@/server/data/shared-key-usage'
import { isSharedKeyAvailable } from '@/server/quota'

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
 * without their own key can reach. The picker can change it before the first
 * send, and that choice travels in the request body — there is no row to persist
 * it to until /api/chat creates one.
 *
 * Deliberately no memory of a previously chosen model. Every new conversation
 * starts on the shared one, which is the only choice guaranteed to work.
 */
export default async function ChatPage() {
  // Concurrent, so the breaker read costs load rather than latency. It is read
  // unconditionally even for a user with keys: knowing whether it applies means
  // knowing which providers they hold, which is one of the reads in this list.
  const [keys, used, sharedKeyAvailable] = await Promise.all([
    listProviderKeys(),
    getTodaysUsage(),
    isSharedKeyAvailable(),
  ])

  return (
    <Chat
      conversationId={null}
      initialMessages={[]}
      provider="google"
      modelId={SHARED_MODEL_ID}
      configuredProviders={keys.map((key) => key.provider)}
      remaining={Math.max(SHARED_KEY_DAILY_MESSAGE_LIMIT - used, 0)}
      sharedKeyAvailable={sharedKeyAvailable}
      // No row yet, so nothing to seed from. A prompt set here is local state
      // that rides along in the first request and is written by
      // createConversation() — the same arrangement the model has. (F23)
      systemPrompt={null}
      emptyState={
        <div className="flex h-full items-center justify-center p-3xl">
          {/* Offering the daily allowance while the breaker is tripped puts a
              promise directly above the composer's refusal of it — the two are
              adjacent on screen, so the contradiction is not subtle. */}
          <p className="max-w-100 text-center text-body-md text-mute">
            {sharedKeyAvailable
              ? `Start a conversation. You have ${SHARED_KEY_DAILY_MESSAGE_LIMIT} free messages a day before you need a key of your own.`
              : 'Start a conversation. Shared access is paused right now, so this needs a key of your own.'}
          </p>
        </div>
      }
    />
  )
}
