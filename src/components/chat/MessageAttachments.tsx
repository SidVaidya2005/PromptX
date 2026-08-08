'use client'

import { useState } from 'react'
import Image from 'next/image'

import { FileTextIcon } from 'lucide-react'

import { ATTACHMENT_INLINE_MAX_PX } from '@/lib/constants'

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'

import type { RenderedAttachment } from '@/types/domain'

type MessageAttachmentsProps = {
  attachments: readonly RenderedAttachment[]
}

/**
 * The files a message was sent with. (F29)
 *
 * Rendered in `position` order, which is the order the chips were in when the
 * message was sent — the array from the server already carries it, and sorting
 * here keeps the optimistic client-side case in step, where the map is built
 * from the composer's own order.
 *
 * Every image is `unoptimized` with explicit dimensions. The Next optimizer runs
 * inside the process that is also serving streams and its cache does not survive
 * a redeploy, and the right size already exists in Storage from upload time —
 * this is `inline_path`, produced once in the browser.
 */
export function MessageAttachments({ attachments }: MessageAttachmentsProps) {
  const [lightbox, setLightbox] = useState<RenderedAttachment | null>(null)

  if (attachments.length === 0) return null

  const ordered = [...attachments].sort((a, b) => a.position - b.position)

  return (
    <>
      <ul className="flex flex-col gap-sm pb-sm">
        {ordered.map((attachment) => (
          <li key={attachment.id}>
            {isImage(attachment) ? (
              <button
                type="button"
                onClick={() => setLightbox(attachment)}
                // DESIGN.md: inline images are max-width 100% of the message
                // column at their natural aspect ratio, in rounded-md.
                className="block w-full cursor-zoom-in overflow-hidden rounded-md focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-primary"
                aria-label="Open image"
              >
                <Image
                  unoptimized
                  src={attachment.inlineUrl ?? attachment.originalUrl}
                  alt=""
                  // Falls back to the derivative's own cap when the dimensions
                  // are absent — a PDF has none, and so does any row written
                  // before F29 added the columns. `h-auto` then lets the real
                  // aspect ratio win once the image has loaded.
                  width={attachment.width ?? ATTACHMENT_INLINE_MAX_PX}
                  height={attachment.height ?? ATTACHMENT_INLINE_MAX_PX}
                  className="h-auto w-full"
                />
              </button>
            ) : (
              // No filename is stored, so a PDF chip says what it is rather than
              // what it was called. See the open item recorded with F29.
              <a
                href={attachment.originalUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-sm rounded-sm border border-hairline bg-canvas px-sm py-xs text-caption text-body hover:text-ink"
              >
                <FileTextIcon className="size-4 text-mute" aria-hidden />
                PDF
              </a>
            )}
          </li>
        ))}
      </ul>

      {/* Mounted only while open, per the F24 finding: Radix calls
          `onOpenChange` only for changes it initiates, so a dialog left mounted
          with an `open` prop never hears about a parent opening it. */}
      {lightbox && (
        <Dialog open onOpenChange={(open) => !open && setLightbox(null)}>
          <DialogContent className="max-w-240 p-sm">
            {/* Required by Radix for an accessible name; the image itself is
                the content and carries no caption of its own. */}
            <DialogTitle className="sr-only">Attached image</DialogTitle>

            {/* The ORIGINAL, not the inline copy. That is the whole point of
                opening it — the thread already showed the 1440px version. */}
            <Image
              unoptimized
              src={lightbox.originalUrl}
              alt=""
              width={lightbox.width ?? ATTACHMENT_INLINE_MAX_PX}
              height={lightbox.height ?? ATTACHMENT_INLINE_MAX_PX}
              className="h-auto max-h-[80dvh] w-full object-contain"
            />
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}

function isImage(attachment: RenderedAttachment): boolean {
  return attachment.mimeType.startsWith('image/')
}
