'use client'

import { useId, useState } from 'react'

import { MAX_PROMPT_BODY_LENGTH, MAX_PROMPT_TITLE_LENGTH } from '@/lib/constants'
import { cn } from '@/lib/utils'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { TagInput } from '@/components/prompts/TagInput'

import type { Prompt } from '@/types/domain'

type PromptDialogProps = {
  /** Null is a new prompt; a row is an edit of that row. */
  prompt: Prompt | null
  /** Always true while mounted — see the note on mounting, below. */
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Every tag in the library, for the chip input's suggestions. */
  suggestions: readonly string[]
  /** Returns false when the save failed, which keeps the dialog open. */
  onSave: (input: { title: string; body: string; tags: string[] }) => Promise<boolean>
  isSaving: boolean
  error: string | null
}

/**
 * The create-and-edit form. (F24)
 *
 * One dialog for both, because the body of the request is identical either way —
 * `updatePromptSchema` *is* `createPromptSchema` — so a second component would
 * be the same form with a different heading and a second place for the two to
 * drift apart.
 *
 * Controlled from the library above rather than owning its own trigger, unlike
 * `KeyDialog`. There is one dialog for the whole grid: a `<Dialog>` per card
 * would mount one Radix portal per prompt, and "New prompt" has no card to hang
 * a trigger on at all.
 *
 * **The library mounts this only while it is open, and that is what seeds the
 * fields — not the open handler.** The first version seeded inside
 * `handleOpenChange`, the arrangement F23 settled for a dialog that owns its own
 * trigger, and it was wrong here in a way that looked right: Radix calls
 * `onOpenChange` only for changes *it* initiates — a trigger, Escape, the
 * overlay, the close button — and never when a parent flips the `open` prop. So
 * the handler ran on every close and on no open at all, and the dialog reopened
 * holding whatever the last prompt left in it. Found by driving the real thing:
 * "New prompt" opened pre-filled with the previously saved prompt, and saving it
 * wrote a byte-for-byte duplicate.
 *
 * Mounting per open makes the seed structural — `useState` initialisers run
 * once, at mount, so there is no event anyone can forget to fire. It costs a
 * mount per open, which is a portal and three inputs.
 */
export function PromptDialog({
  prompt,
  open,
  onOpenChange,
  suggestions,
  onSave,
  isSaving,
  error,
}: PromptDialogProps) {
  const fieldId = useId()

  // Initialisers, not an effect and not an open handler. They run once because
  // the library mounts this component per open — see the note above.
  const [title, setTitle] = useState(prompt?.title ?? '')
  const [body, setBody] = useState(prompt?.body ?? '')
  const [tags, setTags] = useState<string[]>(prompt ? [...prompt.tags] : [])

  const trimmedTitle = title.trim()
  const trimmedBody = body.trim()

  const titleOverCap = trimmedTitle.length > MAX_PROMPT_TITLE_LENGTH
  const bodyOverCap = trimmedBody.length > MAX_PROMPT_BODY_LENGTH

  const isSubmittable =
    trimmedTitle !== '' && trimmedBody !== '' && !titleOverCap && !bodyOverCap && !isSaving

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!isSubmittable) return

    // Trimmed here as well as on the server, which trims authoritatively. This
    // half only spares a round trip for a title that is nothing but spaces.
    if (await onSave({ title: trimmedTitle, body: trimmedBody, tags })) {
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Numeric, never a named width: the DESIGN.md spacing tokens shadow
          Tailwind's container scale, so max-w-2xl would silently be 64px. */}
      <DialogContent className="max-w-160">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{prompt ? 'Edit prompt' : 'New prompt'}</DialogTitle>
            <DialogDescription>
              Saved prompts are yours alone and belong to no conversation. Reuse one
              from the composer whenever you need it.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-lg flex flex-col gap-lg">
            <div className="flex flex-col gap-xs">
              <label htmlFor={`${fieldId}-title`} className="text-body-sm text-body-strong">
                Title
              </label>

              <Input
                id={`${fieldId}-title`}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Code review"
                autoFocus
                disabled={isSaving}
                aria-invalid={titleOverCap ? true : undefined}
              />

              <p className="text-caption text-mute">
                What you will search for. Titles are what the library filters on.
              </p>
            </div>

            <div className="flex flex-col gap-xs">
              <label htmlFor={`${fieldId}-body`} className="text-body-sm text-body-strong">
                Prompt
              </label>

              <textarea
                id={`${fieldId}-body`}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                rows={10}
                placeholder="Review this diff for correctness bugs. Be terse…"
                disabled={isSaving}
                aria-invalid={bodyOverCap ? true : undefined}
                className={cn(
                  'w-full resize-y rounded-sm border border-hairline bg-canvas-soft px-md py-sm',
                  'text-body-sm text-ink placeholder:text-mute',
                  'disabled:pointer-events-none disabled:opacity-50',
                )}
              />

              {/* Counts the trimmed length, because that is what the server
                  bounds. A count disagreeing with the rule doing the rejecting
                  would be worse than no count. */}
              <p
                className={cn(
                  'self-end text-caption tabular-nums',
                  bodyOverCap ? 'text-danger' : 'text-mute',
                )}
              >
                {trimmedBody.length.toLocaleString()} /{' '}
                {MAX_PROMPT_BODY_LENGTH.toLocaleString()}
              </p>
            </div>

            <div className="flex flex-col gap-xs">
              <label htmlFor={`${fieldId}-tags`} className="text-body-sm text-body-strong">
                Tags
              </label>

              <TagInput
                id={`${fieldId}-tags`}
                tags={tags}
                onChange={setTags}
                suggestions={suggestions}
                disabled={isSaving}
              />
            </div>
          </div>

          {error && (
            <p role="alert" className="mt-lg text-body-sm text-danger">
              {error}
            </p>
          )}

          <DialogFooter className="mt-xl">
            <Button
              type="button"
              variant="outline"
              disabled={isSaving}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>

            <Button type="submit" variant="primary" disabled={!isSubmittable}>
              {isSaving ? 'Saving…' : 'Save prompt'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
