import { SHARED_KEY_DAILY_MESSAGE_LIMIT } from '@/lib/constants'

/**
 * The new-conversation page.
 *
 * An empty state and nothing else. The composer is feature 07's, and the
 * conversation row is created on first send rather than when this page loads,
 * so an abandoned visit here leaves nothing behind.
 *
 * DESIGN.md's empty-state: no fill, no border, mute text, one sentence, at most
 * one action, and no illustration.
 */
export default function ChatPage() {
  return (
    <div className="flex h-full items-center justify-center p-3xl">
      <p className="max-w-100 text-center text-body-md text-mute">
        Start a conversation. You have {SHARED_KEY_DAILY_MESSAGE_LIMIT} free
        messages a day before you need a key of your own.
      </p>
    </div>
  )
}
