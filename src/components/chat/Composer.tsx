'use client'

import { useRef, useState } from 'react'

import { ArrowUpIcon, SquareIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

import { ModelPicker } from '@/components/chat/ModelPicker'
import { Button } from '@/components/ui/button'

import type { Provider } from '@/types/domain'

type ComposerProps = {
  provider: Provider
  modelId: string
  configuredProviders: readonly Provider[]
  isStreaming: boolean
  onSend: (text: string) => void
  onStop: () => void
  onSelectModel: (provider: Provider, modelId: string) => void
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
  isStreaming,
  onSend,
  onStop,
  onSelectModel,
}: ComposerProps) {
  const [text, setText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const canSend = text.trim().length > 0 && !isStreaming

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
          placeholder={`Message ${modelId}`}
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
            meter, send. The picker leads it; features 28 and 16 fill the middle. */}
        <div className="flex items-center justify-between gap-sm pt-xs">
          <ModelPicker
            provider={provider}
            modelId={modelId}
            configuredProviders={configuredProviders}
            // Choosing mid-stream cannot affect the request already in flight,
            // and offering it would imply otherwise.
            disabled={isStreaming}
            onSelect={onSelectModel}
          />

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
