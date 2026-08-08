'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { deleteAttachment, uploadAttachment } from '@/lib/attachments'
import {
  ALLOWED_ATTACHMENT_MIME_TYPES,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_MESSAGE,
} from '@/lib/constants'

import type { RenderedAttachment } from '@/types/domain'

/**
 * One file the composer is holding for the next message.
 *
 * `localId` rather than the database id, because a chip exists from the moment a
 * file is chosen and the row does not exist until the server answers. It is also
 * what a retry keeps stable, so the chip does not jump position when the second
 * attempt mints a new row.
 */
export type PendingAttachment = {
  localId: string
  name: string
  mimeType: string
  sizeBytes: number
  /** An object URL while it is the local file being shown. Null for a PDF. */
  previewUrl: string | null
  status: 'uploading' | 'ready' | 'failed'
  /** 0 to 1, weighted across the original and its derivatives by bytes. */
  progress: number
  /** The confirmed row, once the upload has landed and been measured. */
  attachment: RenderedAttachment | null
}

type State = {
  items: PendingAttachment[]
  /** The most recent rejection, cleared the next time files are chosen. */
  error: string | null
}

/**
 * The composer's pending attachments, and everything that can happen to one.
 *
 * Upload starts the moment a file is chosen rather than on send, which is what
 * makes sending instant — by then the bytes are already in Storage and the
 * message carries four ids.
 *
 * The `File` is kept on a ref rather than in state, because retry needs the
 * original bytes and nothing renders from them. Keeping them in state would put
 * a 10 MB object into every re-render's comparison for no reason.
 */
export function useAttachmentUploads() {
  const [state, setState] = useState<State>({ items: [], error: null })
  const files = useRef(new Map<string, File>())

  /**
   * Which chips already have an upload in flight.
   *
   * This exists because the first version started uploads *inside* the
   * `setState` updater, which React calls twice in development StrictMode — so
   * every attachment silently uploaded twice, created two rows and six objects,
   * and linked whichever finished last while the other leaked to the reaper.
   * Nothing on screen showed it; the database is what disagreed.
   *
   * The rule it broke is the ordinary one — a state updater must be pure — and
   * the fix is to make starting an upload an effect keyed on the item, made
   * idempotent by this set so a double-invoked effect cannot double-send either.
   */
  const started = useRef(new Set<string>())

  /**
   * The current items, readable outside a state updater.
   *
   * `remove` and `clear` have real side effects — revoking an object URL and
   * deleting a row — and those must not live inside `setState`, for the reason
   * written above `started`. This mirror is what lets them read the list first
   * and then update it, rather than doing both in one impure callback.
   */
  const itemsRef = useRef<PendingAttachment[]>([])

  const update = useCallback(
    (localId: string, patch: Partial<PendingAttachment>) => {
      setState((current) => ({
        ...current,
        items: current.items.map((item) =>
          item.localId === localId ? { ...item, ...patch } : item,
        ),
      }))
    },
    [],
  )

  const start = useCallback(
    async (localId: string, file: File) => {
      try {
        const attachment = await uploadAttachment(file, {
          onProgress: (progress) => update(localId, { progress }),
        })

        update(localId, { status: 'ready', progress: 1, attachment })
      } catch {
        // `uploadAttachment` has already deleted whatever it created, so there
        // is nothing to clean up here and a retry starts from nothing.
        //
        // Nothing is written to the database to say "failed" either. The send
        // path refuses anything that is not 'ready', so a persisted 'failed'
        // status would be a state no code consults — bookkeeping pretending to
        // be a state machine. What the user needs is this chip saying so and
        // offering another go, which is local by nature.
        update(localId, { status: 'failed', progress: 0 })
      }
    },
    [update],
  )

  /**
   * Validates, then begins uploading. Rejections never become chips.
   *
   * Client-side checks here are a courtesy, not the enforcement — the bucket's
   * own limits are what actually refuse a bad upload, and the send path is what
   * actually refuses a bad attachment. What these buy is an immediate answer
   * instead of a wasted upload that fails on the last byte.
   */
  const add = useCallback(
    (incoming: readonly File[]) => {
      setState((current) => {
        const room = MAX_ATTACHMENTS_PER_MESSAGE - current.items.length
        const accepted: PendingAttachment[] = []
        let error: string | null = null

        for (const file of incoming) {
          if (accepted.length >= room) {
            error = `You can attach up to ${MAX_ATTACHMENTS_PER_MESSAGE} files to one message.`
            break
          }

          const allowed: readonly string[] = ALLOWED_ATTACHMENT_MIME_TYPES
          if (!allowed.includes(file.type)) {
            error = `${file.name} is not a supported file type.`
            continue
          }

          if (file.size > MAX_ATTACHMENT_BYTES) {
            error = `${file.name} is larger than ${Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024)} MB.`
            continue
          }

          const localId = crypto.randomUUID()
          files.current.set(localId, file)

          accepted.push({
            localId,
            name: file.name,
            mimeType: file.type,
            sizeBytes: file.size,
            // The local file, shown immediately. Waiting for the upload to
            // finish before showing anything would leave a blank chip for the
            // whole time the indicator exists to describe.
            previewUrl: file.type.startsWith('image/')
              ? URL.createObjectURL(file)
              : null,
            status: 'uploading',
            progress: 0,
            attachment: null,
          })
        }

        // Nothing is started here. This updater is pure, and the effect below is
        // what begins an upload — see the note on `started`.
        return { items: [...current.items, ...accepted], error }
      })
    },
    [],
  )

  /**
   * Begins any upload that has not begun.
   *
   * An effect rather than a call inside `add`, because `add` computes the new
   * list inside a state updater and a side effect there runs twice under
   * StrictMode. Keyed on the items, guarded by `started`, so it is safe to run
   * as often as React likes.
   */
  useEffect(() => {
    itemsRef.current = state.items

    for (const item of state.items) {
      if (item.status !== 'uploading' || started.current.has(item.localId)) continue

      const file = files.current.get(item.localId)
      if (!file) continue

      started.current.add(item.localId)
      void start(item.localId, file)
    }
  }, [state.items, start])

  /**
   * Drops a chip, and takes its row and objects with it.
   *
   * The object URL is revoked here and nowhere else, which is the whole reason
   * removal and clearing are separate functions below: a sent message keeps
   * rendering from signed URLs the server produced, never from these.
   */
  const remove = useCallback((localId: string) => {
    const item = itemsRef.current.find((candidate) => candidate.localId === localId)

    if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl)
    if (item?.attachment) void deleteAttachment(item.attachment.id)

    files.current.delete(localId)
    started.current.delete(localId)

    setState((current) => ({
      ...current,
      items: current.items.filter((candidate) => candidate.localId !== localId),
    }))
  }, [])

  /** A second attempt at the same file, keeping the chip where it is. */
  const retry = useCallback(
    (localId: string) => {
      if (!files.current.has(localId)) return

      // Cleared BEFORE the state change, so the effect above sees an item that
      // is uploading and not yet started. Retrying is the one path that puts a
      // chip back into a state it has already been in.
      started.current.delete(localId)
      update(localId, { status: 'uploading', progress: 0 })
    },
    [update],
  )

  /**
   * Empties the composer after a successful send.
   *
   * Object URLs are revoked, and that is safe precisely because the sent message
   * does not use them — the confirm call returned signed URLs with the row, so
   * what the thread draws belongs to the thread. Rows are NOT deleted here: they
   * have just been linked to a message.
   */
  const clear = useCallback(() => {
    for (const item of itemsRef.current) {
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl)
    }

    files.current.clear()
    started.current.clear()
    setState({ items: [], error: null })
  }, [])

  const isUploading = state.items.some((item) => item.status === 'uploading')
  const hasFailed = state.items.some((item) => item.status === 'failed')

  return {
    items: state.items,
    error: state.error,
    isUploading,
    hasFailed,
    /** In chip order, which becomes `position` on the message. */
    readyAttachments: state.items
      .map((item) => item.attachment)
      .filter((attachment): attachment is RenderedAttachment => attachment !== null),
    add,
    remove,
    retry,
    clear,
  }
}
