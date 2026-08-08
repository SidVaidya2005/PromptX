'use client'

import { useId, useMemo, useRef, useState } from 'react'
import Link from 'next/link'

import { LibraryIcon } from 'lucide-react'

import { promptBodyPreview, searchPrompts } from '@/lib/prompts'
import { cn } from '@/lib/utils'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { usePromptLibrary } from '@/components/prompts/use-prompt-library'

type PromptPickerProps = {
  disabled: boolean
  /** Handed the chosen prompt's body. Insertion is the composer's job. */
  onInsert: (body: string) => void
}

/**
 * Picks a saved prompt to drop into the composer. (F25)
 *
 * The library is read on the first open and shared for the page session — see
 * `use-prompt-library.ts` for why that cache lives in a module. Nothing is
 * fetched for a session that never opens this.
 *
 * **The keyboard behaviour is the feature, not a refinement.** §25 asks for
 * "type to filter, arrows to move, Enter to insert", so this is a listbox
 * driven from the search input rather than a menu: focus never leaves the field,
 * and the highlighted option is named by `aria-activedescendant`. That is what
 * lets one element own both the typing and the selection — a Radix menu would
 * take the arrows for itself and the typing for its typeahead.
 *
 * The active index is kept rather than the active id, because filtering
 * reorders and shortens the list under it: an index clamps to the new list for
 * free, where an id would have to be looked up and could stop existing.
 */
export function PromptPicker({ disabled, onInsert }: PromptPickerProps) {
  const listId = useId()

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)

  /**
   * Whether this close is an insertion, read by `onCloseAutoFocus` below.
   *
   * A ref rather than state because nothing renders from it and it has to be
   * readable inside the close handler in the same commit that sets it.
   */
  const insertingRef = useRef(false)

  const { prompts, isLoading, error, load } = usePromptLibrary()

  const matches = useMemo(() => searchPrompts(prompts, query), [prompts, query])

  // Filtering can leave the highlight past the end of a shorter list. Clamped
  // during render, the arrangement AppShell uses for an orphaned sheet, rather
  // than in an effect that would paint one frame with nothing highlighted.
  const active = matches.length === 0 ? -1 : Math.min(activeIndex, matches.length - 1)

  function handleOpenChange(next: boolean) {
    setOpen(next)

    if (next) {
      // Idempotent: at most one request per page session, however many times
      // this is opened.
      load()
      setQuery('')
      setActiveIndex(0)
    }
  }

  function insert(body: string) {
    insertingRef.current = true
    onInsert(body)
    setOpen(false)
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (matches.length === 0) return

      const delta = event.key === 'ArrowDown' ? 1 : -1
      // Wraps, so holding one arrow never dead-ends at an edge of a short list.
      setActiveIndex((current) => {
        const from = Math.min(current, matches.length - 1)
        return (from + delta + matches.length) % matches.length
      })

      return
    }

    if (event.key === 'Enter') {
      // Always prevented, even with nothing to insert: this input sits inside
      // the composer's <form>, so an unhandled Enter would submit it and send
      // whatever is in the draft. The picker must never send a message.
      event.preventDefault()

      const chosen = matches[active]
      if (chosen) insert(chosen.body)
    }

    // Escape is Radix's, and is deliberately not touched here. Its dismissal
    // runs on a document-level capture listener that reaches the key before
    // React does — the F21 finding — so a handler here could not have stopped
    // it anyway, and closing is what Escape should do.
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          className="gap-xs bg-canvas px-sm text-body-sm text-body-strong"
          aria-label="Insert a saved prompt"
        >
          <LibraryIcon className="text-mute" />
          Prompts
        </Button>
      </PopoverTrigger>

      {/* Numeric width on the 4px grid: a named one would silently collapse,
          because the DESIGN.md spacing tokens shadow Tailwind's container
          scale. 320px matches the model picker's panel at w-64. */}
      <PopoverContent
        className="flex w-80 flex-col gap-xs p-xs"
        /**
         * Radix returns focus to the trigger when the panel closes, and it does
         * so *after* the composer's own focus call — measured, not predicted:
         * the body landed in the textarea with the caret in the right place and
         * `document.activeElement` on the "Insert a saved prompt" button. This
         * is the seam Radix provides for exactly that, the same one F21 used for
         * the rename input, and preventing the default is what lets the
         * composer's focus stand.
         *
         * Conditional on purpose. Closing WITHOUT inserting — Escape, a click
         * outside — must still hand focus back to the trigger, or a keyboard
         * user who changes their mind is left on `<body>` with nowhere to tab
         * from. So the yield happens only on the path that has somewhere better
         * to send focus.
         */
        onCloseAutoFocus={(event) => {
          if (!insertingRef.current) return

          insertingRef.current = false
          event.preventDefault()
        }}
      >
        <Input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            // Back to the top on every keystroke: after filtering, the best
            // match is the first row, and leaving the highlight where it was
            // would put Enter on an arbitrary one.
            setActiveIndex(0)
          }}
          onKeyDown={handleKeyDown}
          autoFocus
          placeholder="Search prompts"
          aria-label="Search saved prompts"
          // The input keeps focus and the list is driven from here, so these
          // three are what make the highlight real to a screen reader rather
          // than only visible.
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          autoComplete="off"
        />

        {error ? (
          <p role="alert" className="px-sm py-md text-body-sm text-danger">
            {error}
          </p>
        ) : isLoading && prompts.length === 0 ? (
          <p role="status" className="px-sm py-md text-body-sm text-mute">
            Loading your prompts…
          </p>
        ) : prompts.length === 0 ? (
          // The button is not hidden when the library is empty, so this is the
          // one place someone learns what it would have done. A control that
          // vanishes teaches nothing.
          <div className="flex flex-col gap-xs px-sm py-md">
            <p className="text-body-sm text-mute">No saved prompts yet.</p>
            <Link
              href="/prompts"
              className="text-body-sm text-body-strong underline underline-offset-2 hover:text-ink"
            >
              Build your library
            </Link>
          </div>
        ) : matches.length === 0 ? (
          <p role="status" className="px-sm py-md text-body-sm text-mute">
            No prompt matches that.
          </p>
        ) : (
          <ul
            id={listId}
            role="listbox"
            aria-label="Saved prompts"
            className="max-h-72 overflow-y-auto"
          >
            {matches.map((prompt, index) => (
              <li
                key={prompt.id}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === active}
                // onMouseDown, not onClick: the input holds focus and a click
                // would blur it first, which closes the popover on the way down
                // and cancels the click that was supposed to insert.
                onMouseDown={(event) => {
                  event.preventDefault()
                  insert(prompt.body)
                }}
                onMouseEnter={() => setActiveIndex(index)}
                className={cn(
                  'cursor-default rounded-sm px-md py-sm select-none',
                  'pointer-coarse:min-h-11',
                  index === active && 'bg-ink/10',
                )}
              >
                <p
                  className={cn(
                    'truncate text-body-sm',
                    index === active ? 'text-ink' : 'text-body-strong',
                  )}
                >
                  {prompt.title}
                </p>

                <p className="truncate text-caption text-mute">
                  {prompt.tags.length > 0
                    ? prompt.tags.join(' · ')
                    : promptBodyPreview(prompt.body)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  )
}
