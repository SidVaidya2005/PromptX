'use client'

import { useEffect, useRef, useState } from 'react'

import { PencilIcon } from 'lucide-react'

import { outlineAnchorId } from '@/lib/outline'
import { cn } from '@/lib/utils'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'

type UserMessageProps = {
  id: string
  text: string
  /** True for the brief flash after the outline rail jumps to this message. */
  isHighlighted: boolean
  /** False while a response is streaming — one generation at a time. */
  canEdit: boolean
  /** How many messages sit after this one. Zero means an edit destroys nothing. */
  followingCount: number
  onEdit: (id: string, text: string) => void
}

/**
 * A prompt the user sent, and the only message in the thread they can rewrite.
 *
 * Split out of `MessageBubble` at feature 19: what was four lines of markup now
 * carries an inline editor and a destructive confirmation, and leaving it inline
 * would have pushed that file past the point `code-standards.md` calls a defect.
 *
 * The bubble keeps the anchor id, so the outline rail can still jump here while
 * the message is being edited.
 */
export function UserMessage({
  id,
  text,
  isHighlighted,
  canEdit,
  followingCount,
  onEdit,
}: UserMessageProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(text)
  const [confirming, setConfirming] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const changed = draft.trim() !== text.trim()
  const canSave = draft.trim().length > 0 && changed

  useEffect(() => {
    const textarea = textareaRef.current
    if (!editing || !textarea) return

    textarea.focus()
    // Caret at the end rather than selecting everything: an edit is usually a
    // correction to an existing prompt, and a select-all means the first
    // keystroke silently discards it.
    textarea.setSelectionRange(textarea.value.length, textarea.value.length)
    resize(textarea)
  }, [editing])

  function open() {
    setDraft(text)
    setEditing(true)
  }

  function cancel() {
    setEditing(false)
    setDraft(text)
  }

  /** Saving is only destructive when something follows; otherwise just do it. */
  function save() {
    if (!canSave) return

    if (followingCount > 0) {
      setConfirming(true)
      return
    }

    commit()
  }

  function commit() {
    setConfirming(false)
    setEditing(false)
    onEdit(id, draft.trim())
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      cancel()
      return
    }

    // Enter saves and Shift+Enter inserts a newline, matching the composer.
    // Consistency inside this app beats matching any other product's editor —
    // it is the same textarea muscle memory two inches further up the page.
    //
    // isComposing is not optional. While an IME candidate window is open Enter
    // commits the candidate, and treating that as "save" submits a half-typed
    // correction — invisible to anyone testing in English.
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return

    event.preventDefault()
    save()
  }

  if (editing) {
    return (
      <div id={outlineAnchorId(id)} className="flex scroll-mt-lg justify-end">
        {/* Full width while editing, unlike the 80% bubble at rest. A correction
            to a long prompt is hard to make through a narrow column, and the
            right-aligned shape stops meaning anything once it is a form. */}
        <div
          className={cn(
            'w-full rounded-md border border-hairline bg-canvas-soft p-md',
            'transition-colors focus-within:border-mute',
          )}
        >
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value)
              resize(event.target)
            }}
            onKeyDown={handleKeyDown}
            rows={1}
            aria-label="Edit message"
            className={cn(
              // DESIGN.md `composer-input`, on the bubble's own surface.
              'w-full resize-none bg-transparent py-sm text-body-md text-ink outline-none',
              'max-h-[40dvh] overflow-y-auto',
            )}
          />

          <div className="flex items-center justify-end gap-sm pt-xs">
            <Button type="button" variant="ghost" onClick={cancel}>
              Cancel
            </Button>
            <Button type="button" variant="primary" disabled={!canSave} onClick={save}>
              Save
            </Button>
          </div>
        </div>

        <EditConfirmation
          open={confirming}
          followingCount={followingCount}
          onOpenChange={setConfirming}
          onConfirm={commit}
        />
      </div>
    )
  }

  return (
    <div id={outlineAnchorId(id)} className="group flex scroll-mt-lg flex-col items-end">
      <div
        className={cn(
          'max-w-4/5 rounded-md border border-hairline bg-canvas-soft px-lg py-md',
          'text-body-md whitespace-pre-wrap text-ink transition-colors',
          // The rail jump's acknowledgement. Brightening the existing hairline
          // rather than adding a ring keeps it inside the elevation system —
          // DESIGN.md builds emphasis from surface contrast, not from a new
          // outline, and a coloured one would need a chromatic accent that does
          // not exist here.
          isHighlighted && 'border-primary',
        )}
      >
        {text}
      </div>

      {/* The same quartet the assistant message's meta row uses. The coarse
          variant is the one that matters: without it the entire feature is
          unreachable on a touch device, where there is no hover to reveal it. */}
      {canEdit && (
        <div
          className={cn(
            'flex items-center pt-xxs',
            'opacity-0 transition-opacity',
            'group-hover:opacity-100 group-focus-within:opacity-100',
            'pointer-coarse:opacity-100',
          )}
        >
          <Button type="button" variant="ghost" size="sm" onClick={open}>
            <PencilIcon />
            Edit
          </Button>
        </div>
      )}
    </div>
  )
}

type EditConfirmationProps = {
  open: boolean
  followingCount: number
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}

/**
 * Shown only when the edit would actually remove something.
 *
 * Editing the last prompt in a thread — which is what someone does when the
 * answer failed, or when they catch a typo before the reply lands — removes
 * nothing, and a dialog that warns about deleting nothing is a dialog people
 * learn to dismiss without reading. That habit is then carried into the one case
 * where it mattered.
 *
 * An AlertDialog rather than a Dialog, per the rule F11 established: it carries
 * `role="alertdialog"`, drops outside-click dismissal, and focuses Cancel rather
 * than the button that destroys something.
 */
function EditConfirmation({
  open,
  followingCount,
  onOpenChange,
  onConfirm,
}: EditConfirmationProps) {
  const plural = followingCount === 1 ? 'message' : 'messages'

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Resend this message?</AlertDialogTitle>
          <AlertDialogDescription>
            The{' '}
            <span className="text-body-strong">
              {followingCount} {plural}
            </span>{' '}
            after it will be deleted and a new response generated. This cannot be
            undone.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Resend</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/**
 * Collapse before measuring, or `scrollHeight` only ever reports the tallest the
 * box has been and the textarea can grow but never shrink. Same trick as the
 * composer's.
 */
function resize(textarea: HTMLTextAreaElement): void {
  textarea.style.height = 'auto'
  textarea.style.height = `${textarea.scrollHeight}px`
}
