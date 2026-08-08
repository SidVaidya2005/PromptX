'use client'

import { useId, useState } from 'react'

import { BookmarkIcon, CheckIcon } from 'lucide-react'

import { MAX_PROMPT_BODY_LENGTH } from '@/lib/constants'
import { titleFromBody } from '@/lib/prompts'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { usePromptMutation } from '@/components/prompts/use-prompt-mutation'

type SaveToLibraryProps = {
  /** The dialog's live draft, not the saved system prompt. */
  body: string
}

/**
 * "Save to library", inside the system-prompt dialog. (F23, built at F24)
 *
 * F23 struck this from its own list with the note that it belongs wherever the
 * library it saves to actually exists, which is here.
 *
 * **An inline reveal rather than a second dialog.** A prompt needs a title and
 * the system-prompt dialog has no field for one, so the obvious build is a
 * nested `Dialog` — and a Radix dialog inside a Radix dialog puts the new input
 * inside an already-trapped `FocusScope`, which is three rounds of debugging F21
 * has already paid for once. Pressing the button reveals a title field in the
 * dialog that is already open; nothing new is mounted in a portal.
 *
 * Confirmation is a line of text rather than a toast, because `sonner` is
 * approved but not installed and F24 is not the feature where a dependency
 * arrives — the same Dependencies gate F22 applied to a Switch.
 *
 * It saves the **draft**, not the stored prompt, so a prompt can be written and
 * filed without ever being applied to the conversation.
 */
export function SaveToLibrary({ body }: SaveToLibraryProps) {
  const fieldId = useId()

  const [isNaming, setIsNaming] = useState(false)
  const [title, setTitle] = useState('')
  const [savedTitle, setSavedTitle] = useState<string | null>(null)

  const { save, isPending, error, clearError } = usePromptMutation()

  const trimmedBody = body.trim()
  const canSave = trimmedBody !== '' && trimmedBody.length <= MAX_PROMPT_BODY_LENGTH

  function startNaming() {
    clearError()
    setSavedTitle(null)
    setTitle(titleFromBody(body))
    setIsNaming(true)
  }

  async function handleSave() {
    const trimmedTitle = title.trim()
    if (trimmedTitle === '' || isPending) return

    // No tags. The dialog is a text field and a button, and asking someone to
    // tag a prompt they are filing in passing is the surest way to have them
    // not file it; the library's own editor is where tags belong.
    const prompt = await save(null, { title: trimmedTitle, body: trimmedBody, tags: [] })

    if (prompt) {
      setIsNaming(false)
      setSavedTitle(prompt.title)
    }
  }

  if (!canSave) return null

  if (!isNaming) {
    return (
      <div className="flex items-center gap-sm">
        <Button type="button" variant="outline" size="sm" onClick={startNaming}>
          <BookmarkIcon />
          Save to library
        </Button>

        {savedTitle && (
          <p role="status" className="flex items-center gap-xxs text-caption text-success">
            <CheckIcon className="size-3" aria-hidden />
            Saved as “{savedTitle}”
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-xs rounded-sm border border-hairline p-sm">
      <label htmlFor={fieldId} className="text-caption text-body-strong">
        Save this prompt to your library as
      </label>

      <div className="flex flex-wrap items-center gap-sm">
        <Input
          id={fieldId}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          // Enter must not reach the dialog's own form, which would save the
          // system prompt instead of the library entry.
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void handleSave()
            }
          }}
          autoFocus
          disabled={isPending}
          className="min-w-60 flex-1"
        />

        <Button
          type="button"
          variant="primary"
          size="sm"
          disabled={isPending || title.trim() === ''}
          onClick={() => void handleSave()}
        >
          {isPending ? 'Saving…' : 'Save'}
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={isPending}
          onClick={() => setIsNaming(false)}
        >
          Cancel
        </Button>
      </div>

      {error && (
        <p role="alert" className="text-caption text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
