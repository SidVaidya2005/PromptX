'use client'

import { shareUrl } from '@/lib/share'

import { CopyButton } from '@/components/chat/CopyButton'
import { useShareMutation } from '@/components/chat/use-share-mutation'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

type ShareDialogProps = {
  conversationId: string
  /** The slug as the parent currently knows it. Null means not shared. */
  shareSlug: string | null
  onOpenChange: (open: boolean) => void
  /** Lifts the new slug to the parent, which owns it across closes. */
  onSlugChange: (slug: string | null) => void
}

/**
 * Publishing a conversation, and taking it back. (F33)
 *
 * A `Dialog` rather than an `AlertDialog`, and revoking is a plain button rather
 * than a second confirmation. F11's rule is about irreversible loss: revoking
 * loses a URL, and a new one is one click away. What it does *not* recover is
 * the old URL — re-sharing mints a fresh slug — so the copy below says that
 * where someone will read it before pressing, rather than in a dialog after.
 *
 * **Mounted only while open**, per F24: Radix calls `onOpenChange` only for
 * changes it initiates, so a dialog left mounted with an `open` prop never hears
 * about a parent opening it. Here that matters less than it did for the prompt
 * library — this holds no seeded form state — but the arrangement that makes the
 * mistake unrepresentable is still the one to copy.
 */
export function ShareDialog({
  conversationId,
  shareSlug,
  onOpenChange,
  onSlugChange,
}: ShareDialogProps) {
  const { setShared, isSaving, error } = useShareMutation()

  async function publish() {
    const slug = await setShared(conversationId, true)
    // undefined is a failure with `error` already set; null cannot come back
    // from a publish. Only a real slug moves the parent's state.
    if (slug) onSlugChange(slug)
  }

  async function revoke() {
    const slug = await setShared(conversationId, false)
    // Explicitly `=== null`, not falsy: undefined is the failed request, and
    // treating it as a revoke would clear a link that is still live.
    if (slug === null) onSlugChange(null)
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{shareSlug ? 'Link is live' : 'Share this conversation'}</DialogTitle>

          <DialogDescription>
            {shareSlug
              ? 'Anyone with this link can read this conversation — no account needed. Attachments are not included.'
              : 'This creates a link anyone can open, with no account needed. The whole conversation becomes readable to anyone you send it to.'}
          </DialogDescription>
        </DialogHeader>

        {shareSlug && (
          <div className="flex items-center gap-sm rounded-sm border border-hairline bg-canvas-soft px-md py-sm">
            {/* Selectable and wrapping rather than truncated: someone whose copy
                button fails needs to be able to read the whole thing. */}
            <p className="min-w-0 flex-1 break-all font-mono text-code text-body">
              {shareUrl(shareSlug)}
            </p>

            <CopyButton value={shareUrl(shareSlug)} label="Copy the share link" />
          </div>
        )}

        {error && (
          <p role="alert" className="text-body-sm text-danger">
            {error}
          </p>
        )}

        <DialogFooter>
          {shareSlug ? (
            <>
              {/* Said here rather than in a confirmation dialog, because it is
                  the one consequence that is not obvious: the link people
                  already hold stops working and cannot be brought back. */}
              <p className="mr-auto text-body-sm text-mute">
                Revoking breaks this link for good. Sharing again makes a new one.
              </p>

              <Button variant="outline" onClick={() => void revoke()} disabled={isSaving}>
                {isSaving ? 'Revoking…' : 'Revoke link'}
              </Button>
            </>
          ) : (
            <Button variant="primary" onClick={() => void publish()} disabled={isSaving}>
              {isSaving ? 'Creating…' : 'Create link'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
