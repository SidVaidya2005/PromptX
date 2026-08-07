'use client'

import { RefreshCwIcon } from 'lucide-react'

import { PROVIDER_LABELS } from '@/lib/constants'
import {
  findModel,
  isModelAvailable,
  MODEL_CATALOG,
  PROVIDER_ORDER,
  willUseSharedKey,
} from '@/lib/models'
import { cn } from '@/lib/utils'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

import type { Provider } from '@/types/domain'

type RegenerateMenuProps = {
  /** The conversation's current choice, and what "same model" means. */
  provider: Provider
  modelId: string
  configuredProviders: readonly Provider[]
  remaining: number
  sharedKeyAvailable: boolean
  /** Undefined asks for the same model; a pair asks for that one instead. */
  onRegenerate: (model?: { provider: Provider; modelId: string }) => void
}

/**
 * Asks for a second answer, optionally from a different model.
 *
 * A different model here applies to **this generation only**. Nothing in this
 * path persists a choice, so the conversation's own provider and model are
 * untouched and the composer's picker does not move — only the new assistant
 * row records what actually answered. That is what makes a thread whose model
 * changed partway legible rather than a thread that silently redirected itself.
 *
 * What is offered is gated by the same two predicates the composer reads —
 * `isModelAvailable` for whether a key exists, `willUseSharedKey` for whether
 * the daily allowance even applies. The composite is written here rather than
 * shared with the composer because the two want different answers from it: the
 * composer needs to know *why* it is blocked so it can say so in a sentence,
 * and this menu only needs yes or no, per model. The primitives are the shared
 * definition; this is a second reading of them, not a second copy of the rule.
 */
export function RegenerateMenu({
  provider,
  modelId,
  configuredProviders,
  remaining,
  sharedKeyAvailable,
  onRegenerate,
}: RegenerateMenuProps) {
  const current = findModel(provider, modelId)

  /** Whether a send to this model would be refused right now. */
  function sendable(candidate: Provider, candidateId: string): boolean {
    if (!isModelAvailable(candidate, candidateId, configuredProviders)) return false

    // A model answered by a key of the caller's own has nothing to do with the
    // shared allowance, so neither limit applies to it.
    if (!willUseSharedKey(candidate, candidateId, configuredProviders)) return true

    return sharedKeyAvailable && remaining > 0
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/* Deliberately not the `Button` component, for the reason CopyButton
            gives beside it: this sits inside a hover-revealed strip of `mute`
            text at caption scale, and Button's smallest size is a 32px control
            with its own colour. The coarse-pointer padding is what carries it
            to the WCAG 44px floor on a touch device. */}
        <button
          type="button"
          aria-label="Regenerate response"
          className={cn(
            'inline-flex items-center gap-xs rounded-xs text-caption text-mute',
            'transition-colors hover:text-body-strong data-open:text-body-strong',
            'pointer-coarse:min-h-11 pointer-coarse:px-sm',
          )}
        >
          <RefreshCwIcon aria-hidden className="size-3.5" />
          Regenerate
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent className="max-h-96 w-64" align="start">
        <DropdownMenuItem
          disabled={!sendable(provider, modelId)}
          onSelect={() => onRegenerate()}
        >
          <span className="truncate">Same model ({current?.label ?? modelId})</span>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {PROVIDER_ORDER.map((entry) => {
          // Everything this provider serves except the one already offered
          // above. Listing it twice would read as two different actions.
          const alternatives = MODEL_CATALOG[entry].filter(
            (model) => !(entry === provider && model.id === modelId),
          )

          // A provider PromptX ships nothing for is skipped rather than shown
          // empty. The picker explains that absence because it is the surface
          // someone goes to when a key did nothing; this menu is about choosing
          // an alternative, and a heading with no options under it is noise.
          if (alternatives.length === 0) return null

          return (
            <div key={entry}>
              <DropdownMenuLabel>{PROVIDER_LABELS[entry]}</DropdownMenuLabel>

              {alternatives.map((model) => (
                <DropdownMenuItem
                  key={model.id}
                  disabled={!sendable(entry, model.id)}
                  onSelect={() => onRegenerate({ provider: entry, modelId: model.id })}
                >
                  <span className="truncate">{model.label}</span>
                </DropdownMenuItem>
              ))}
            </div>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
