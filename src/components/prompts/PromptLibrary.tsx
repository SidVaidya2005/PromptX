'use client'

import { useMemo, useState } from 'react'

import { PlusIcon, SearchIcon } from 'lucide-react'

import { collectTags, filterPrompts } from '@/lib/prompts'
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
import { Input } from '@/components/ui/input'
import { PromptCard } from '@/components/prompts/PromptCard'
import { PromptDialog } from '@/components/prompts/PromptDialog'
import { usePromptMutation } from '@/components/prompts/use-prompt-mutation'

import type { Prompt } from '@/types/domain'

type PromptLibraryProps = {
  prompts: readonly Prompt[]
}

/**
 * The `/prompts` page below its heading: search, tag filter, grid, and the two
 * dialogs. (F24)
 *
 * **Filtering happens here, in the browser, over the array the server already
 * sent.** Typing narrows the grid with no round trip and no debounce, which is
 * the whole reason this is a client component. A personal library is tens of
 * rows; F27's message search is thousands and lives in the URL for that reason,
 * and the two are deliberately different mechanisms rather than an
 * inconsistency. The accepted cost is that a filtered view is not linkable.
 *
 * One `PromptDialog` and one `AlertDialog` serve every card. Per-card dialogs
 * would mount a Radix portal per prompt, and "New prompt" has no card to belong
 * to anyway.
 */
export function PromptLibrary({ prompts }: PromptLibraryProps) {
  const [query, setQuery] = useState('')
  const [tag, setTag] = useState<string | null>(null)

  // Null means "a new prompt"; the flag is what distinguishes that from closed.
  const [editing, setEditing] = useState<Prompt | null>(null)
  const [isEditorOpen, setIsEditorOpen] = useState(false)
  const [deleting, setDeleting] = useState<Prompt | null>(null)

  const { save, remove, isPending, error, clearError } = usePromptMutation()

  const tags = useMemo(() => collectTags(prompts), [prompts])
  const visible = useMemo(() => filterPrompts(prompts, { query, tag }), [prompts, query, tag])

  // A tag can stop existing while it is the active filter — the last prompt
  // carrying it is edited or deleted — which would leave an empty grid under a
  // chip that is no longer in the row. Adjusted during render, the arrangement
  // AppShell uses for an orphaned sheet, rather than in an effect.
  if (tag !== null && !tags.includes(tag)) {
    setTag(null)
  }

  function openEditor(prompt: Prompt | null) {
    clearError()
    setEditing(prompt)
    setIsEditorOpen(true)
  }

  async function handleSave(input: { title: string; body: string; tags: string[] }) {
    return (await save(editing?.id ?? null, input)) !== null
  }

  async function handleDelete() {
    if (!deleting) return

    if (await remove(deleting.id)) setDeleting(null)
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-sm">
        <div className="relative min-w-60 flex-1">
          <SearchIcon
            aria-hidden
            className="pointer-events-none absolute left-md top-1/2 size-4 -translate-y-1/2 text-mute"
          />

          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search titles"
            aria-label="Search prompts by title"
            className="pl-2xl"
          />
        </div>

        <Button variant="primary" onClick={() => openEditor(null)}>
          <PlusIcon />
          New prompt
        </Button>
      </div>

      {tags.length > 0 && (
        <div className="mt-lg">
          <ul aria-label="Filter by tag" className="flex flex-wrap gap-xs">
            {tags.map((name) => {
              const isActive = tag === name

              return (
                <li key={name}>
                  <button
                    type="button"
                    // Clicking the active tag clears it, which is the only way
                    // back to the whole library without a separate "All" chip
                    // that would be the odd one out in a row of real tags.
                    onClick={() => setTag(isActive ? null : name)}
                    aria-pressed={isActive}
                    className={cn(
                      'rounded-pill border px-sm py-xxs text-caption transition-colors',
                      'pointer-coarse:min-h-11 pointer-coarse:px-md',
                      isActive
                        ? 'border-primary text-ink'
                        : 'border-hairline text-body hover:text-ink',
                    )}
                  >
                    {name}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {prompts.length === 0 ? (
        <EmptyState
          title="No saved prompts yet"
          body="Keep the instructions you reuse — a review checklist, a tone of voice, a format you always ask for — and drop them into any conversation."
          action={
            <Button variant="primary" onClick={() => openEditor(null)}>
              <PlusIcon />
              New prompt
            </Button>
          }
        />
      ) : visible.length === 0 ? (
        <EmptyState
          title="Nothing matches"
          body="No prompt has that title under this tag."
          action={
            <Button
              variant="outline"
              onClick={() => {
                setQuery('')
                setTag(null)
              }}
            >
              Clear filters
            </Button>
          }
        />
      ) : (
        <ul className="mt-xl grid gap-lg tablet:grid-cols-2 desktop:grid-cols-3">
          {visible.map((prompt) => (
            <li key={prompt.id} className="flex">
              <PromptCard prompt={prompt} onEdit={openEditor} onDelete={setDeleting} />
            </li>
          ))}
        </ul>
      )}

      {/* Mounted only while open, which is what seeds its fields — Radix calls
          `onOpenChange` only for changes it initiates, never when a parent flips
          the prop, so an open handler would run on every close and on no open at
          all. Left mounted, the editor reopened holding the last prompt and
          saving wrote a duplicate; that was found by driving the page, not by
          reading it. See the note on `PromptDialog`. */}
      {isEditorOpen && (
        <PromptDialog
          prompt={editing}
          open
          onOpenChange={setIsEditorOpen}
          suggestions={tags}
          onSave={handleSave}
          isSaving={isPending}
          error={error}
        />
      )}

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(next) => {
          if (isPending) return
          if (!next) {
            setDeleting(null)
            clearError()
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete prompt?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="break-words text-body-strong">{deleting?.title}</span>{' '}
              will be deleted. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {error && (
            <p role="alert" className="text-body-sm text-danger">
              {error}
            </p>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isPending}
              // Radix closes on click by default. It has to stay open while the
              // request is in flight, and stay open to show an error.
              onClick={(event) => {
                event.preventDefault()
                void handleDelete()
              }}
            >
              {isPending ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

type EmptyStateProps = {
  title: string
  body: string
  action: React.ReactNode
}

/**
 * DESIGN.md's `empty-state`: no fill, no border, mute text, centred, one
 * sentence and at most one action. Two of them exist because "you have no
 * prompts" and "your filter matches none of them" need different sentences and
 * opposite actions — offering "Clear filters" to someone with an empty library
 * would be advice that does nothing.
 */
function EmptyState({ title, body, action }: EmptyStateProps) {
  return (
    <div className="mt-xl flex flex-col items-center gap-md px-lg py-3xl text-center">
      <p className="text-body-md text-mute">{title}</p>
      <p className="max-w-120 text-body-sm text-mute">{body}</p>
      <div className="mt-sm">{action}</div>
    </div>
  )
}
