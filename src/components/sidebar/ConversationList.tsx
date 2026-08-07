import { formatRelativeTime, groupConversations } from '@/lib/conversations'

import { ConversationRow } from '@/components/sidebar/ConversationRow'

import type { ConversationSummary } from '@/types/domain'

type ConversationListProps = {
  /**
   * Deliberately a promise, not an array. Nothing under src/components/ may
   * import from src/server/, so the layout starts the query and hands the
   * pending result down; awaiting it here rather than there is what lets the
   * shell paint first.
   */
  conversations: Promise<ConversationSummary[]>
}

/**
 * The conversation list, grouped by recency.
 *
 * An async Server Component rather than part of Sidebar itself, so the shell
 * can paint before the query resolves — Sidebar wraps it in a Suspense boundary
 * whose fallback is the skeleton. Without that split the whole three-column
 * frame would wait on a database round trip.
 *
 * `now` is captured once and threaded through both the grouping and every row's
 * label, so a request that straddles midnight cannot file a conversation under
 * one heading and date it against another.
 *
 * No element here carries an id. Below 1024px the desktop <aside> is display:none
 * but still in the document while the drawer copy is mounted, so any id would
 * exist twice.
 */
export async function ConversationList({
  conversations: pending,
}: ConversationListProps) {
  const conversations = await pending

  if (conversations.length === 0) {
    return <p className="px-md py-sm text-body-sm text-mute">No conversations yet.</p>
  }

  const now = new Date()

  return (
    <div className="flex flex-col">
      {groupConversations(conversations, now).map(({ label, conversations: rows }) => (
        <div key={label}>
          {/* DESIGN.md's sidebar-group-label: sentence case in mute carries the
              hierarchy, so there is no uppercase treatment. */}
          <h2 className="px-md pt-lg pb-xs text-caption text-mute">{label}</h2>

          <ul aria-label={label} className="flex flex-col gap-xxs">
            {rows.map((conversation) => (
              <ConversationRow
                key={conversation.id}
                id={conversation.id}
                title={conversation.title}
                updatedAt={conversation.updated_at}
                relativeTime={formatRelativeTime(conversation.updated_at, now)}
                pinnedAt={conversation.pinned_at}
              />
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}
