'use client'

import { useRef, useState } from 'react'

import { XIcon } from 'lucide-react'

import { MAX_PROMPT_TAGS, MAX_PROMPT_TAG_LENGTH } from '@/lib/constants'
import { normalizeTagInput } from '@/lib/prompts'
import { cn } from '@/lib/utils'

import { Input } from '@/components/ui/input'

type TagInputProps = {
  tags: readonly string[]
  onChange: (tags: string[]) => void
  /** Every tag already in the library, offered as you type. */
  suggestions: readonly string[]
  disabled: boolean
  /** Owned above so the label can point at it. The datalist derives its own. */
  id: string
}

const COMMIT_KEYS = new Set(['Enter', ',', 'Tab'])

/**
 * The tag field: committed chips, plus a text input that suggests tags the user
 * already has. (F24)
 *
 * The suggestions are the point of the whole component rather than a flourish.
 * Free text invites `deploy` and `deploys` as two tags that never match each
 * other, and the tag filter above the grid is only as useful as the tag set is
 * small — so the cheapest moment to prevent a near-duplicate is while it is
 * being typed.
 *
 * A native `<datalist>` rather than a Radix combobox: it is one element, it is
 * keyboard- and screen-reader-accessible without a focus scope, and this
 * codebase has no combobox primitive — the Dependencies gate F22 applied to a
 * Switch applies here too. The cost is that its dropdown is not themeable, which
 * is a real deviation from `DESIGN.md`'s palette and the reason to revisit at
 * F37 if it looks wrong; the alternative was ~200 lines of listbox that F37
 * would then have to audit instead.
 *
 * Normalisation happens twice on purpose. `normalizeTagInput()` is what makes a
 * chip appear lowercased as it is committed, and `promptTagsSchema` is what
 * decides what is stored — the client half is convenience and never the guard.
 */
export function TagInput({
  tags,
  onChange,
  suggestions,
  disabled,
  id,
}: TagInputProps) {
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const isFull = tags.length >= MAX_PROMPT_TAGS

  // Offering a tag that is already on this prompt would be offering a no-op.
  const available = suggestions.filter((tag) => !tags.includes(tag))

  function commit(raw: string) {
    const tag = normalizeTagInput(raw)

    setDraft('')

    // Silently ignored rather than reported: re-typing a tag that is already
    // there is not an error, and the chip the user wanted is on screen either
    // way. The cap is what the counter below the field is for.
    if (tag === null || tags.includes(tag) || isFull) return

    onChange([...tags, tag])
  }

  function remove(tag: string) {
    onChange(tags.filter((existing) => existing !== tag))

    // Focus would otherwise land on <body> when the chip's own button unmounts,
    // which is the same class of problem F21 hit with a rename input — except
    // here there is somewhere obvious for it to go.
    inputRef.current?.focus()
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    // Tab only commits when there is something to commit, so the field never
    // steals a keystroke that was meant to leave it.
    if (COMMIT_KEYS.has(event.key) && (event.key !== 'Tab' || draft.trim() !== '')) {
      event.preventDefault()
      commit(draft)
      return
    }

    // Backspace on an empty field removes the last chip — the convention every
    // chip input has, and the only way to correct a typo without a mouse.
    if (event.key === 'Backspace' && draft === '' && tags.length > 0) {
      event.preventDefault()
      onChange(tags.slice(0, -1))
    }
  }

  return (
    <div className="flex flex-col gap-xs">
      {tags.length > 0 && (
        <ul className="flex flex-wrap gap-xs">
          {tags.map((tag) => (
            <li key={tag}>
              {/* A chip is `status-chip` geometry with a hairline instead of a
                  fill: the dialog surface is canvas-soft and so is the chip's
                  specified background, which is the invisible-container trap
                  F15 and F16 both hit. */}
              <span className="inline-flex items-center gap-xxs rounded-pill border border-hairline py-xxs pl-sm pr-xxs text-caption text-body">
                {tag}

                <button
                  type="button"
                  onClick={() => remove(tag)}
                  disabled={disabled}
                  aria-label={`Remove the tag ${tag}`}
                  className={cn(
                    'inline-flex size-4 items-center justify-center rounded-pill',
                    'text-mute transition-colors hover:text-ink',
                    'disabled:pointer-events-none disabled:opacity-50',
                    'pointer-coarse:size-6',
                  )}
                >
                  <XIcon className="size-3" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <Input
        id={id}
        ref={inputRef}
        list={`${id}-suggestions`}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        // A tag typed and then abandoned by clicking Save is one the user
        // believes they added. Committing on blur is what makes the chip appear
        // before the form reads its own state.
        onBlur={() => commit(draft)}
        maxLength={MAX_PROMPT_TAG_LENGTH}
        disabled={disabled || isFull}
        autoComplete="off"
        placeholder={isFull ? `${MAX_PROMPT_TAGS} tags is the limit` : 'Add a tag…'}
        aria-describedby={`${id}-hint`}
      />

      <datalist id={`${id}-suggestions`}>
        {available.map((tag) => (
          <option key={tag} value={tag} />
        ))}
      </datalist>

      <p id={`${id}-hint`} className="text-caption text-mute">
        Enter or comma adds a tag. {tags.length} of {MAX_PROMPT_TAGS} used.
      </p>
    </div>
  )
}
