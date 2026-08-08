'use client'

import { useState } from 'react'

import { ScrollTextIcon } from 'lucide-react'

import { MAX_SYSTEM_PROMPT_LENGTH } from '@/lib/constants'
import { systemPromptPreview } from '@/lib/titles'
import { cn } from '@/lib/utils'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { SaveToLibrary } from '@/components/chat/SaveToLibrary'

type SystemPromptControlProps = {
  /** Null means the provider's own default. Not an empty string — see below. */
  systemPrompt: string | null
  disabled: boolean
  /** Returns false when the save failed, which keeps the dialog open. */
  onSave: (systemPrompt: string | null) => Promise<boolean>
  /** Surfaced under the textarea. Owned above, because the mutation is. */
  error: string | null
}

/**
 * The conversation's standing instruction, set from the composer toolbar. (F23)
 *
 * It sits here rather than in a thread header because there is no thread header
 * to sit in: `AppShell`'s is `desktop:hidden`, and DESIGN.md's only reference to
 * one is that mobile bar. The composer already holds the other per-conversation
 * choice that decides what the *next* message does — the model — so this is the
 * toolbar's second answer to the same question rather than new chrome.
 *
 * The trigger says "Default" or a short preview, deliberately not the whole
 * prompt: at 360px it shares one line with the model picker and the quota
 * meter. Reading it in full is what the dialog is for.
 */
export function SystemPromptControl({
  systemPrompt,
  disabled,
  onSave,
  error,
}: SystemPromptControlProps) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(systemPrompt ?? '')
  const [isSaving, setIsSaving] = useState(false)

  /**
   * Reseeded in the open handler rather than an effect.
   *
   * The prop moves underneath this component in ways that are easy to miss — a
   * save resolves, or `/chat` becomes a real conversation once the first
   * message creates it — so the draft cannot simply be initial state. An effect
   * watching `open` would do it, but `react-hooks/set-state-in-effect` forbids
   * it here and is right to: opening is an event, and seeding from the event is
   * both cheaper and one render shorter than reacting to it afterwards.
   */
  function handleOpenChange(next: boolean) {
    if (next) setDraft(systemPrompt ?? '')
    setOpen(next)
  }

  const trimmed = draft.trim()
  const overCap = trimmed.length > MAX_SYSTEM_PROMPT_LENGTH

  // Empty and null are the same state, so clearing a prompt that was already
  // absent is not a change worth a round trip.
  const next = trimmed === '' ? null : trimmed
  const unchanged = next === systemPrompt

  async function handleSave() {
    if (overCap || unchanged) {
      setOpen(false)
      return
    }

    setIsSaving(true)

    try {
      // Left open on failure: the typed prompt exists only in this textarea,
      // and closing would be the one action that loses it.
      if (await onSave(next)) setOpen(false)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          className="max-w-45 gap-xs bg-canvas px-sm text-body-sm text-body-strong"
          aria-label={
            systemPrompt
              ? `System prompt: ${systemPrompt}. Edit system prompt`
              : 'System prompt: Default. Set a system prompt'
          }
        >
          <ScrollTextIcon className="text-mute" />
          <span className="truncate">{systemPromptPreview(systemPrompt)}</span>
        </Button>
      </DialogTrigger>

      {/* Numeric, never max-w-2xl: the DESIGN.md spacing tokens shadow
          Tailwind's container scale, so a named width silently collapses to a
          few pixels. 640px gives a 10,000-character prompt a readable measure
          without leaving the dialog's own 448px default looking cramped. */}
      <DialogContent className="max-w-160">
        <DialogHeader>
          <DialogTitle>System prompt</DialogTitle>
          <DialogDescription>
            Standing instructions for this conversation. Applies to the next
            message onwards — answers already in the thread are unchanged.
          </DialogDescription>
        </DialogHeader>

        {/* No `id`, so no `htmlFor`: the composer renders once, but the habit of
            labelling by wrapping costs nothing and cannot collide. */}
        <label className="flex flex-col gap-xs">
          <span className="sr-only">System prompt</span>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={10}
            placeholder="You are a careful editor. Prefer plain language…"
            className={cn(
              'w-full resize-y rounded-sm border border-hairline bg-canvas-soft px-md py-sm',
              'text-body-sm text-ink placeholder:text-mute',
            )}
          />
        </label>

        <SaveToLibrary body={draft} />

        <div className="flex items-center justify-between gap-sm">
          <p className="text-caption text-mute">
            Leave empty to use the provider&rsquo;s default.
          </p>

          {/* Counts the trimmed length, because that is what the server bounds.
              A count that disagreed with the rule doing the rejecting would be
              worse than no count. */}
          <p
            className={cn('text-caption tabular-nums', overCap ? 'text-danger' : 'text-mute')}
          >
            {trimmed.length.toLocaleString()} / {MAX_SYSTEM_PROMPT_LENGTH.toLocaleString()}
          </p>
        </div>

        {error && (
          <p role="alert" className="text-body-sm text-danger">
            {error}
          </p>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={isSaving}>
              Cancel
            </Button>
          </DialogClose>

          <Button onClick={() => void handleSave()} disabled={isSaving || overCap}>
            {isSaving ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
