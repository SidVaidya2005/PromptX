import { notFound } from 'next/navigation'

import { FileTextIcon, ImageIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

import { getSharedConversation, type SharedMessage } from '@/server/data/shared'

import { MarkdownErrorBoundary } from '@/components/chat/MarkdownErrorBoundary'
import { MarkdownMessage } from '@/components/chat/MarkdownMessage'

/**
 * Never cached, at any layer. (F33)
 *
 * Revocation has to take effect on the next request, and a cached copy of a
 * revoked conversation would defeat the entire mechanism. This export stops
 * static generation and ISR; the `Cache-Control: private, no-store` header in
 * `next.config.ts` stops a CDN or a browser holding it. Both are required — the
 * export alone still permits a downstream cache, and the header alone still
 * permits a build-time render.
 *
 * If `cacheComponents` is ever enabled project-wide, this route is excluded.
 */
export const dynamic = 'force-dynamic'

type SharePageProps = {
  /** A Promise in Next 16 — the synchronous fallback 15 allowed is gone. */
  params: Promise<{ slug: string }>
}

/**
 * `noindex`, and it is not the same protection the slug is. (F33)
 *
 * "Public to anyone who has it" is not "published". A ~71-bit slug is
 * unguessable, but unguessable is irrelevant once someone pastes the link into a
 * page a crawler reads — at which point the conversation would join a search
 * index and stop being shared-with-whoever-I-sent-it-to. The title is
 * deliberately generic for the same reason: a tab or a link preview should not
 * put the conversation's subject somewhere the owner did not.
 */
export const metadata = {
  title: 'Shared conversation · PromptX',
  robots: { index: false, follow: false },
}

/**
 * A conversation someone chose to publish, read-only, for anyone with the link.
 *
 * **The only route in the application reachable without a session**, and the
 * only one that reads through the `anon` RLS policies. It uses
 * `createAnonSupabaseClient()` via `getSharedConversation()` for a reason worth
 * restating where it is easy to find: F03's share policies are `for select to
 * anon`, and Postgres applies a policy only when the role matches — so the
 * ordinary cookie-bound client would show *nothing* to a signed-in visitor
 * opening a colleague's link. Reading anonymously makes every visitor identical.
 *
 * There is no composer, no model picker, no owner identity, and no route back
 * into the application beyond the wordmark. What a reader gets is the title, the
 * exchange, and which model wrote each answer.
 */
export default async function SharePage({ params }: SharePageProps) {
  const { slug } = await params

  const conversation = await getSharedConversation(slug)

  // Covers "no such slug" and "revoked" identically, because after a revoke they
  // are the same thing. A 404 rather than a "this link has expired" page: the
  // second would confirm to anyone probing that a conversation had once been
  // here, which is exactly the disclosure the F11/F15 rule declines to make.
  if (!conversation) notFound()

  return (
    <div className="min-h-dvh bg-canvas">
      <header className="border-b border-hairline">
        <div className="mx-auto flex w-full max-w-180 items-center justify-between gap-md px-lg py-md">
          <span className="text-body-sm text-mute">PromptX</span>
          <span className="text-caption text-mute">Shared conversation</span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-180 px-lg py-xl">
        <h1 className="text-display-sm text-ink">{conversation.title}</h1>

        <div className="mt-xl flex flex-col gap-xl">
          {conversation.messages.map((message) => (
            <SharedBubble key={message.id} message={message} />
          ))}
        </div>

        {/* Says what this page is, without saying whose it is. A reader who
            arrived from a pasted link has no other way to know they are looking
            at a snapshot rather than something live. */}
        <p className="mt-3xl border-t border-hairline pt-lg text-body-sm text-mute">
          This is a read-only copy of a conversation someone chose to share. It
          is not live, and replying is not possible here.
        </p>
      </main>
    </div>
  )
}

/**
 * One message, rendered read-only.
 *
 * Deliberately not `MessageBubble`, which is wired to editing, regeneration,
 * outline anchors and jump highlighting — none of which exist on a page with no
 * session. What it shares with the thread is the markdown pipeline, so a shared
 * answer renders exactly as its owner saw it, error boundary included: the
 * boundary matters more here than in the thread, because a malformed fence on a
 * public page would otherwise take out the whole route with no way to recover.
 */
function SharedBubble({ message }: { message: SharedMessage }) {
  const isUser = message.role === 'user'

  return (
    <div className={cn('flex flex-col', isUser ? 'items-end' : 'items-start')}>
      <div
        className={cn(
          isUser
            ? // DESIGN.md `message-user`: canvas-soft, hairline, rounded-md,
              // right-aligned at ~80% of the column.
              'max-w-[80%] rounded-md border border-hairline bg-canvas-soft px-lg py-md text-body-md text-ink'
            : // DESIGN.md `message-assistant`: no fill, no border, full width.
              'w-full text-body-md',
        )}
      >
        {isUser ? (
          // Plain text, never markdown. A prompt is what somebody typed, and
          // rendering it would let a `#` at the start of a line become a
          // heading — the thread does not do it either.
          <p className="whitespace-pre-wrap">{message.content}</p>
        ) : (
          <MarkdownErrorBoundary content={message.content}>
            <MarkdownMessage content={message.content} isStreaming={false} />
          </MarkdownErrorBoundary>
        )}
      </div>

      {message.attachments.length > 0 && (
        <ul className="flex flex-wrap gap-sm pt-sm">
          {message.attachments.map((attachment) => (
            <li
              key={attachment.id}
              className="flex items-center gap-xs rounded-sm border border-hairline px-sm py-xs text-caption text-mute"
            >
              {attachment.mimeType === 'application/pdf' ? (
                <FileTextIcon className="size-3.5" aria-hidden />
              ) : (
                <ImageIcon className="size-3.5" aria-hidden />
              )}
              {/**
               * A placeholder, and the absence of the file is the feature. (F33)
               *
               * The anon policy exposes this row's mime type so the reader can be
               * told something was attached; the storage bucket's policies stay
               * owner-scoped, so the object itself is unreachable. **Nothing on
               * this page may call the signed-URL helper** — one call would turn
               * every placeholder into a readable copy of a private file, which
               * is the single thing this whole arrangement exists to prevent.
               */}
              {attachment.mimeType === 'application/pdf'
                ? 'PDF not included'
                : 'Image not included'}
            </li>
          ))}
        </ul>
      )}

      {/* Which model wrote it, which is usually the interesting part of a shared
          conversation, and says nothing about who owns it. */}
      {!isUser && message.modelId && (
        <p className="pt-sm font-mono text-code text-mute">{message.modelId}</p>
      )}
    </div>
  )
}
