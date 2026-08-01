'use client'

import { useId, useState, type ReactNode } from 'react'

import { PROVIDER_KEY_MIN_LENGTH } from '@/lib/constants'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useKeyMutation } from '@/components/settings/use-key-mutation'

import type { Provider } from '@/types/domain'

type KeyDialogProps = {
  provider: Provider
  label: string
  isReplacing: boolean
  trigger: ReactNode
}

/**
 * The add / replace form for one provider.
 *
 * The input is `type="password"` so the key is not left legible on a screen
 * someone else can see, and `autoComplete="off"` so a browser never offers to
 * remember it — a stored provider key in a password manager keyed to this site
 * is a copy of the secret we went to the trouble of encrypting.
 */
export function KeyDialog({ provider, label, isReplacing, trigger }: KeyDialogProps) {
  const [open, setOpen] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const inputId = useId()

  const { saveKey, isPending, error, clearError } = useKeyMutation()

  const isSubmittable = apiKey.trim().length >= PROVIDER_KEY_MIN_LENGTH && !isPending

  function handleOpenChange(next: boolean) {
    setOpen(next)

    // The typed key is dropped the moment the dialog closes, either way. It has
    // no reason to survive in component state after the form is gone.
    if (!next) {
      setApiKey('')
      clearError()
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!isSubmittable) return

    const saved = await saveKey({ provider, apiKey: apiKey.trim() })

    // Closing is what clears the field, via handleOpenChange. On failure the
    // dialog stays open with the key still in it, so a probe that could not
    // reach the provider can simply be retried.
    if (saved) handleOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>

      <DialogContent className="max-w-112">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>
              {isReplacing ? `Replace your ${label} key` : `Add your ${label} key`}
            </DialogTitle>
            <DialogDescription>
              {isReplacing
                ? `This replaces the ${label} key you have stored. The old one stops working immediately.`
                : `Stored encrypted. Only the last four characters are ever shown back to you.`}
            </DialogDescription>
          </DialogHeader>

          <div className="mt-lg">
            <label htmlFor={inputId} className="text-body-sm text-body-strong">
              API key
            </label>

            <Input
              id={inputId}
              // Not `type="text"`, and not remembered by the browser.
              type="password"
              autoComplete="off"
              spellCheck={false}
              autoFocus
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="Paste your key"
              disabled={isPending}
              aria-describedby={error ? `${inputId}-error` : undefined}
              aria-invalid={error ? true : undefined}
              className="mt-xs font-mono text-code"
            />

            <p className="mt-xs text-caption text-mute">
              Paste the whole key. It is checked against {label} before it is saved.
            </p>

            {error ? (
              <p
                id={`${inputId}-error`}
                role="alert"
                className="mt-sm text-body-sm text-danger"
              >
                {error}
              </p>
            ) : null}
          </div>

          <DialogFooter className="mt-xl">
            <Button
              type="button"
              variant="outline"
              disabled={isPending}
              onClick={() => handleOpenChange(false)}
            >
              Cancel
            </Button>

            <Button type="submit" variant="primary" disabled={!isSubmittable}>
              {isPending ? 'Checking…' : 'Save key'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
