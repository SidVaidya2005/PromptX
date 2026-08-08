'use client'

import { PencilIcon, Trash2Icon } from 'lucide-react'

import { promptBodyPreview } from '@/lib/prompts'

import { Button } from '@/components/ui/button'

import type { Prompt } from '@/types/domain'

type PromptCardProps = {
  prompt: Prompt
  onEdit: (prompt: Prompt) => void
  onDelete: (prompt: Prompt) => void
}

/**
 * One saved prompt in the grid. (F24)
 *
 * DESIGN.md's `prompt-card`: canvas-soft on a hairline, `rounded-md`, 16px
 * padding, the title in `body-md-strong` and the body clamped to three lines.
 *
 * **Not a link and not a button.** A prompt has no page of its own to navigate
 * to, and wrapping the whole card in a button would put the two action buttons
 * inside it — the F11 problem of a control nested in a control, which is invalid
 * markup before it is an accessibility failure. The card is a plain article and
 * both actions are explicit.
 *
 * Both actions are also **always visible**, rather than appearing on hover the
 * way a sidebar row's overflow trigger does. The invariant is that nothing is
 * reachable only on hover; a card at this size has room for two buttons, so the
 * simplest way to satisfy it is not to hide them in the first place.
 */
export function PromptCard({ prompt, onEdit, onDelete }: PromptCardProps) {
  return (
    // h-full so a short card still reaches the bottom of its grid row, which is
    // what gives the tag list's `mt-auto` something to push against.
    <article className="flex h-full w-full flex-col gap-sm rounded-md border border-hairline bg-canvas-soft p-lg">
      <div className="flex items-start justify-between gap-sm">
        <h3 className="min-w-0 break-words text-body-md-strong text-ink">
          {prompt.title}
        </h3>

        <div className="flex shrink-0 items-center gap-xxs">
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Edit ${prompt.title}`}
            onClick={() => onEdit(prompt)}
          >
            <PencilIcon />
          </Button>

          <Button
            variant="danger"
            size="icon"
            aria-label={`Delete ${prompt.title}`}
            onClick={() => onDelete(prompt)}
          >
            <Trash2Icon />
          </Button>
        </div>
      </div>

      {/* line-clamp decides what is seen; promptBodyPreview decides what is in
          the document, which is what keeps a 10,000-character body out of a card
          that shows three lines of it. */}
      <p className="line-clamp-3 whitespace-pre-wrap text-body-sm text-body">
        {promptBodyPreview(prompt.body)}
      </p>

      {prompt.tags.length > 0 && (
        <ul aria-label="Tags" className="mt-auto flex flex-wrap gap-xs pt-xs">
          {prompt.tags.map((tag) => (
            <li
              key={tag}
              // status-chip geometry with a hairline in place of the fill: the
              // card is already canvas-soft, and so is the chip's specified
              // background. (F15, F16)
              className="rounded-pill border border-hairline px-sm py-xxs text-caption text-body"
            >
              {tag}
            </li>
          ))}
        </ul>
      )}
    </article>
  )
}
