'use client'

import { useState } from 'react'

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
import { KeyDialog } from '@/components/settings/KeyDialog'
import { useKeyMutation } from '@/components/settings/use-key-mutation'

import type { Provider } from '@/types/domain'

type KeyRowProps = {
  provider: Provider
  label: string
  /** The stored key's last four characters, or null when none is configured. */
  lastFour: string | null
  /** The user's own name for the key, if they gave one. */
  keyLabel: string | null
  /** Already formatted on the server, so nothing here depends on the clock. */
  addedOn: string | null
}

/**
 * One provider's row on the keys page.
 *
 * The masked key is `••••` plus the last four rather than DESIGN.md's literal
 * `sk-…4f2a`. That example was written with OpenAI in mind, and only the last
 * four characters are stored — printing an `sk-` prefix in front of a Google
 * key, which begins `AIza`, would be showing the user something untrue about
 * their own credential.
 */
export function KeyRow({ provider, label, lastFour, keyLabel, addedOn }: KeyRowProps) {
  const [confirmingRemove, setConfirmingRemove] = useState(false)
  const { removeKey, isPending, error } = useKeyMutation()

  const isConfigured = lastFour !== null

  async function handleRemove() {
    const removed = await removeKey(provider)
    if (removed) setConfirmingRemove(false)
  }

  return (
    <div className="border-b border-hairline py-lg">
      <div className="flex flex-wrap items-center gap-md">
        <div className="min-w-0 flex-1">
          <p className="text-body-md-strong text-ink">{label}</p>

          {isConfigured ? (
            <p className="mt-xxs flex flex-wrap items-center gap-x-sm gap-y-xxs">
              <span className="font-mono text-code text-mute">
                {'•'.repeat(4)}
                {lastFour}
              </span>

              {keyLabel ? (
                <span className="text-body-sm text-mute">{keyLabel}</span>
              ) : null}

              {addedOn ? (
                <span className="text-caption text-mute">Added {addedOn}</span>
              ) : null}
            </p>
          ) : (
            <p className="mt-xxs text-body-sm text-mute">Not configured</p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-xs">
          <KeyDialog
            provider={provider}
            label={label}
            isReplacing={isConfigured}
            trigger={
              <Button variant="outline" size="sm">
                {isConfigured ? 'Replace' : 'Add'}
              </Button>
            }
          />

          {isConfigured ? (
            <Button
              variant="danger"
              size="sm"
              onClick={() => setConfirmingRemove(true)}
            >
              Remove
            </Button>
          ) : null}
        </div>
      </div>

      {/* The remove failure surfaces here rather than inside the dialog, because
          the dialog closes on success and a message inside it would vanish with
          it. */}
      {error && !confirmingRemove ? (
        <p role="alert" className="mt-sm text-body-sm text-danger">
          {error}
        </p>
      ) : null}

      <AlertDialog open={confirmingRemove} onOpenChange={setConfirmingRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove your {label} key?</AlertDialogTitle>
            <AlertDialogDescription>
              The stored key is deleted and {label} models stop being available
              until you add another. Your conversations are not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {error ? (
            <p role="alert" className="text-body-sm text-danger">
              {error}
            </p>
          ) : null}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isPending}
              // Not the default AlertDialogAction close-on-select: the dialog
              // must stay open if the request fails, or the error has nowhere
              // to appear and the row silently looks unchanged.
              onClick={(event) => {
                event.preventDefault()
                void handleRemove()
              }}
            >
              {isPending ? 'Removing…' : 'Remove key'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
