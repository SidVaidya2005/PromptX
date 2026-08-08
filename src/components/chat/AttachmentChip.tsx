'use client'

import Image from 'next/image'

import { FileTextIcon, RotateCcwIcon, XIcon } from 'lucide-react'

import { ATTACHMENT_THUMB_PX } from '@/lib/constants'
import { cn } from '@/lib/utils'

import type { PendingAttachment } from '@/components/chat/use-attachment-uploads'

type AttachmentChipProps = {
  attachment: PendingAttachment
  onRemove: (localId: string) => void
  onRetry: (localId: string) => void
}

/** DESIGN.md puts the composer thumbnail at 40px; the stored thumb is 2× that. */
const CHIP_IMAGE_PX = ATTACHMENT_THUMB_PX / 2

/**
 * One pending upload in the composer. (F29)
 *
 * DESIGN.md `attachment-chip`: `canvas` fill on the composer's `canvas-soft`
 * surface, hairline border, caption type, `rounded-sm`. The fill is what makes
 * it legible — this is the inverse of the trap F15 and F16 both hit, where a
 * `canvas-soft` container sat invisibly on a `canvas-soft` parent.
 *
 * Neither control is hover-revealed. Remove and retry are the only ways to
 * correct a mistake here, so a touch device that could not reach them would have
 * no way to withdraw a file — the invariant, and the case it exists for.
 */
export function AttachmentChip({ attachment, onRemove, onRetry }: AttachmentChipProps) {
  const failed = attachment.status === 'failed'
  const uploading = attachment.status === 'uploading'

  return (
    <li
      className={cn(
        'relative flex items-center gap-sm rounded-sm border px-sm py-xs',
        'bg-canvas text-caption text-body',
        failed ? 'border-danger' : 'border-hairline',
      )}
    >
      {attachment.previewUrl ? (
        <Image
          // unoptimized, always: the Next optimizer runs inside the process
          // that is also serving streams, and this image is either a local
          // object URL or a size that was produced once at upload time.
          unoptimized
          src={attachment.previewUrl}
          alt=""
          width={CHIP_IMAGE_PX}
          height={CHIP_IMAGE_PX}
          className={cn(
            'size-10 shrink-0 rounded-xs object-cover',
            uploading && 'opacity-60',
          )}
        />
      ) : (
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xs bg-canvas-soft">
          <FileTextIcon className="size-4 text-mute" aria-hidden />
        </span>
      )}

      <span className="flex min-w-0 flex-col gap-xxs">
        <span className="max-w-40 truncate text-body-strong">{attachment.name}</span>

        {failed ? (
          <span className="text-danger">Upload failed</span>
        ) : uploading ? (
          // A number as well as a bar. The bar is the glanceable version and the
          // percentage is what tells someone a slow upload is still moving.
          <span className="flex items-center gap-xs text-mute">
            <span
              role="progressbar"
              aria-label={`Uploading ${attachment.name}`}
              aria-valuenow={Math.round(attachment.progress * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
              className="h-xxs w-16 overflow-hidden rounded-pill bg-canvas-soft"
            >
              <span
                className="block h-full bg-mute transition-[width] duration-150"
                style={{ width: `${Math.round(attachment.progress * 100)}%` }}
              />
            </span>
            {Math.round(attachment.progress * 100)}%
          </span>
        ) : (
          <span className="text-mute">{formatBytes(attachment.sizeBytes)}</span>
        )}
      </span>

      {failed && (
        <button
          type="button"
          onClick={() => onRetry(attachment.localId)}
          aria-label={`Retry uploading ${attachment.name}`}
          className="rounded-sm p-xxs text-mute hover:text-ink focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <RotateCcwIcon className="size-3.5" />
        </button>
      )}

      <button
        type="button"
        onClick={() => onRemove(attachment.localId)}
        aria-label={`Remove ${attachment.name}`}
        className="rounded-sm p-xxs text-mute hover:text-ink focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <XIcon className="size-3.5" />
      </button>
    </li>
  )
}

/** Whole numbers: a chip is 40px tall and nobody is auditing a byte count. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
