'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'

import { ArrowUpIcon, SquareIcon } from 'lucide-react'

import { SHARED_KEY_DAILY_MESSAGE_LIMIT } from '@/lib/constants'
import { willUseSharedKey } from '@/lib/models'
import { cn } from '@/lib/utils'

import { ModelPicker } from '@/components/chat/ModelPicker'
import { QuotaMeter } from '@/components/chat/QuotaMeter'
import { SystemPromptControl } from '@/components/chat/SystemPromptControl'
import { Button } from '@/components/ui/button'

import type { Provider } from '@/types/domain'

type ComposerProps = {
  provider: Provider
  modelId: string
  configuredProviders: readonly Provider[]
  /** Shared-key messages left today. Irrelevant while a personal key answers. */
  remaining: number
  /** False while the global monthly ceiling is spent. Also irrelevant to a BYOK model. */
  sharedKeyAvailable: boolean
  isStreaming: boolean
  /** The conversation's standing instruction. Null is "the provider's default". */
  systemPrompt: string | null
  /** Surfaced inside the system prompt dialog; the mutation is owned by Chat. */
  systemPromptError: string | null
  onSend: (text: string) => void
  onStop: () => void
  onSelectModel: (provider: Provider, modelId: string) => void
  onSaveSystemPrompt: (systemPrompt: string | null) => Promise<boolean>
}

/**
 * The message input, shared by /chat and /chat/[id].
 *
 * Controlled from above: it owns the draft and nothing else. Sending, stopping,
 * the chosen model and the conversation's identity all belong to Chat, which
 * owns the useChat instance — this file would otherwise need a second route to
 * the same server.
 */
export function Composer({
  provider,
  modelId,
  configuredProviders,
  remaining,
  sharedKeyAvailable,
  isStreaming,
  systemPrompt,
  systemPromptError,
  onSend,
  onStop,
  onSelectModel,
  onSaveSystemPrompt,
}: ComposerProps) {
  const [text, setText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Whether the allowance applies at all is a property of the SELECTED model,
  // not of the user. Someone with an OpenRouter key who has spent their shared
  // messages is not out of anything — switching models makes this false and the
  // composer works again, which is exactly what resolveModel() would have done.
  const onSharedKey = willUseSharedKey(provider, modelId, configuredProviders)
  const exhausted = onSharedKey && remaining <= 0

  // The other axis, and it is global rather than personal: the month's budget is
  // spent for everybody. Nothing this user does changes it, which is why the
  // message below offers a key rather than tomorrow.
  const budgetSpent = onSharedKey && !sharedKeyAvailable

  // Either one refuses. Kept as separate booleans rather than one `blocked`,
  // because they say different things and the composer has to say the right one.
  const blocked = exhausted || budgetSpent

  const canSend = text.trim().length > 0 && !isStreaming && !blocked

  function submit() {
    if (!canSend) return

    onSend(text)
    setText('')

    const textarea = textareaRef.current
    if (textarea) textarea.style.height = 'auto'
  }

  function handleChange(event: React.ChangeEvent<HTMLTextAreaElement>) {
    setText(event.target.value)

    // Collapse before measuring, or scrollHeight only ever reports the tallest
    // the box has been and the textarea can grow but never shrink.
    const textarea = event.target
    textarea.style.height = 'auto'
    textarea.style.height = `${textarea.scrollHeight}px`
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    // isComposing is the whole point of this branch. While an IME candidate
    // window is open, Enter commits the candidate — treating it as "send" fires
    // a half-typed message and is invisible to anyone testing in English.
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return

    event.preventDefault()
    submit()
  }

  return (
    <div className="mx-auto w-full max-w-180 px-lg pb-lg">
      {/* Above the composer rather than inside the toolbar: it is a sentence,
          not a control, and it has to stay legible at 360px where the toolbar is
          already carrying the picker and the send button. */}
      {/* The breaker wins when both apply. A daily allowance that resets at
          midnight is the smaller and more hopeful of the two facts, and leading
          with it would tell someone to come back tomorrow to find the same wall. */}
      {budgetSpent ? (
        <p role="status" className="pb-sm text-body-sm text-danger">
          Shared access is temporarily unavailable.{' '}
          <Link
            href="/settings/keys"
            className="underline underline-offset-2 hover:text-ink"
          >
            Add your own API key
          </Link>{' '}
          to keep going, or pick a model you already have a key for.
        </p>
      ) : (
        exhausted && (
          <p role="status" className="pb-sm text-body-sm text-danger">
            You&rsquo;ve used your {SHARED_KEY_DAILY_MESSAGE_LIMIT} free messages for
            today.{' '}
            <Link
              href="/settings/keys"
              className="underline underline-offset-2 hover:text-ink"
            >
              Add your own API key
            </Link>{' '}
            to keep going, or pick a model you already have a key for.
          </p>
        )
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
        className={cn(
          // DESIGN.md `composer`: canvas-soft fill, hairline border, rounded-md,
          // 10px padding, and the border brightening to mute on focus-within.
          'rounded-md border border-hairline bg-canvas-soft p-md transition-colors',
          'focus-within:border-mute',
        )}
      >
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          rows={1}
          disabled={blocked}
          placeholder={
            blocked ? 'Pick another model or add a key' : `Message ${modelId}`
          }
          aria-label="Message"
          className={cn(
            // DESIGN.md `composer-input`: transparent, ink text, mute
            // placeholder, body-md. The chrome belongs to the form above.
            'w-full resize-none bg-transparent py-sm text-body-md text-ink outline-none',
            'placeholder:text-mute',
            // DESIGN.md caps the grow at ~40% of the viewport, then scrolls.
            // An arbitrary value on purpose: the figure is viewport-relative and
            // the token scale is in px, so there is nothing here to reference.
            'max-h-[40dvh] overflow-y-auto',
          )}
        />

        {/* DESIGN.md `composer-toolbar`: model picker, attach button, quota
            meter, send. Feature 28 fills the remaining gap. */}
        <div className="flex items-center justify-between gap-sm pt-xs">
          {/* Wraps, and F23 is why. With the model picker alone the quota meter
              had room to sit beside it at 360px; adding the system prompt
              control squeezed it to 58px, where "16 of 20 free messages left
              today" rendered as four lines in a column — measured, not
              predicted. Wrapping lets the meter drop to its own line at narrow
              widths and changes nothing at desktop, where all three fit. */}
          <div className="flex min-w-0 flex-wrap items-center gap-x-sm gap-y-xs">
            <ModelPicker
              provider={provider}
              modelId={modelId}
              configuredProviders={configuredProviders}
              // Choosing mid-stream cannot affect the request already in flight,
              // and offering it would imply otherwise.
              disabled={isStreaming}
              onSelect={onSelectModel}
            />

            {/* Beside the picker because it answers the same question: what the
                NEXT message will do. Disabled mid-stream for the same reason —
                editing it cannot affect the request already in flight, and
                offering it would imply otherwise. */}
            <SystemPromptControl
              systemPrompt={systemPrompt}
              disabled={isStreaming}
              onSave={onSaveSystemPrompt}
              error={systemPromptError}
            />

            {/* Only while the shared key would answer. A user on their own key
                is not spending this allowance, so a count of it is noise — and
                so is a count of messages nobody can send, which is why the
                breaker hides it rather than leaving "17 of 20 left" above a
                composer that refuses all seventeen. */}
            {onSharedKey && !budgetSpent && <QuotaMeter remaining={remaining} />}
          </div>

          {isStreaming ? (
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={onStop}
              aria-label="Stop generating"
            >
              <SquareIcon />
            </Button>
          ) : (
            <Button
              type="submit"
              variant="primary"
              size="icon"
              disabled={!canSend}
              aria-label="Send message"
            >
              <ArrowUpIcon />
            </Button>
          )}
        </div>
      </form>
    </div>
  )
}
