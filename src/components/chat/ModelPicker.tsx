'use client'

import Link from 'next/link'

import { ChevronDownIcon } from 'lucide-react'

import { PROVIDER_LABELS } from '@/lib/constants'
import {
  decodeModelKey,
  encodeModelKey,
  findModel,
  isModelAvailable,
  isSharedModel,
  MODEL_CATALOG,
  PROVIDER_ORDER,
} from '@/lib/models'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

import type { Provider } from '@/types/domain'

type ModelPickerProps = {
  provider: Provider
  modelId: string
  /** Providers this user holds a key for. Everything else is greyed out. */
  configuredProviders: readonly Provider[]
  disabled: boolean
  onSelect: (provider: Provider, modelId: string) => void
}

/**
 * Chooses which model answers the next message.
 *
 * One radio group spans every provider rather than one group each, because the
 * choice is single-select across the whole catalog — a group per provider would
 * let two look selected at once. Radix allows `Label` and `Separator` inside a
 * `RadioGroup`, so the headings cost nothing.
 *
 * The value is a `provider:modelId` composite, never a bare model id. `Gemini
 * 3.6 Flash` exists under both `google` and `openrouter` with different ids and
 * different bills, so an id alone would light the wrong row.
 *
 * What is greyed out comes from `isModelAvailable`, which is the same function
 * `resolveModel()` refuses on. The picker must not offer what the server will
 * reject: a disabled row explains itself, a 400 after a send does not.
 */
export function ModelPicker({
  provider,
  modelId,
  configuredProviders,
  disabled,
  onSelect,
}: ModelPickerProps) {
  const selected = findModel(provider, modelId)

  function handleValueChange(value: string) {
    const next = decodeModelKey(value)
    // Null only if the DOM handed back something that is not in the catalog.
    if (next) onSelect(next.provider, next.modelId)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          // The current model is a technical identifier, so DM Mono — but the
          // label rather than the raw id, which at `anthropic/claude-opus-5`
          // would not survive a 360px toolbar.
          className="max-w-45 gap-xs bg-canvas px-sm font-mono text-code-md text-body-strong"
          aria-label={`Model: ${selected?.label ?? modelId}. Change model`}
        >
          <span className="truncate">{selected?.label ?? modelId}</span>
          <ChevronDownIcon className="text-mute" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent className="max-h-96 w-64" align="start">
        <DropdownMenuRadioGroup
          value={encodeModelKey(provider, modelId)}
          onValueChange={handleValueChange}
        >
          {PROVIDER_ORDER.map((entry, index) => (
            <ProviderGroup
              key={entry}
              provider={entry}
              configuredProviders={configuredProviders}
              showSeparator={index > 0}
            />
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

type ProviderGroupProps = {
  provider: Provider
  configuredProviders: readonly Provider[]
  showSeparator: boolean
}

function ProviderGroup({
  provider,
  configuredProviders,
  showSeparator,
}: ProviderGroupProps) {
  const models = MODEL_CATALOG[provider]
  const hasKey = configuredProviders.includes(provider)

  // A key would not help here — PromptX ships no models for this provider yet.
  // Shown rather than hidden so that someone who has added a key and found that
  // nothing happened learns why in the one place they would look for it.
  const shipsNothing = models.length === 0

  // Offered when a key would actually unlock something. Never for a provider
  // with an empty catalog, where it would be advice that does not work.
  const offerKey = !hasKey && !shipsNothing

  return (
    <>
      {showSeparator && <DropdownMenuSeparator />}
      <DropdownMenuLabel>{PROVIDER_LABELS[provider]}</DropdownMenuLabel>

      {shipsNothing ? (
        // Not a DropdownMenuItem: this is not an option that happens to be
        // unavailable, it is the absence of options. Making it an item would
        // put it in the keyboard order as something a user could try to choose.
        <p className="px-md py-sm text-body-sm text-mute">No models available yet</p>
      ) : (
        models.map((model) => {
          const available = isModelAvailable(provider, model.id, configuredProviders)

          return (
            <DropdownMenuRadioItem
              key={model.id}
              value={encodeModelKey(provider, model.id)}
              disabled={!available}
            >
              <span className="truncate">{model.label}</span>
              {/* Only while the shared key is what would answer. Once a Google
                  key exists this model is billed to its owner, and calling it
                  shared would be untrue. */}
              {isSharedModel(provider, model.id) && !hasKey && (
                <DropdownMenuShortcut>Shared</DropdownMenuShortcut>
              )}
            </DropdownMenuRadioItem>
          )
        })
      )}

      {offerKey && (
        // Deliberately NOT disabled. `ITEM_BASE` carries
        // `data-disabled:pointer-events-none`, so a Radix-disabled item cannot
        // hold a working link — the one affordance on this row that has to work.
        <DropdownMenuItem asChild>
          <Link href="/settings/keys">Add a {PROVIDER_LABELS[provider]} key</Link>
        </DropdownMenuItem>
      )}
    </>
  )
}
