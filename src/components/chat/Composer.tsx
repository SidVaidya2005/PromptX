'use client'

import { useRef, useState } from 'react'

import { ArrowUpIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

import { Button } from '@/components/ui/button'
import { useSendMessage } from '@/components/chat/use-send-message'

import type { Provider } from '@/types/domain'

type ComposerProps = {
  /** Null on /chat. The conversation is created by the first send, not by this mount. */
  conversationId: string | null
  provider: Provider
  modelId: string
}

/**
 * The message input, shared by /chat and /chat/[id].
 *
 * Nothing streams yet, so "disabled while streaming" is for now "disabled while
 * the request is in flight". Feature 08 turns the send button into a stop
 * button for the duration of a response.
 */
export function Composer({ conversationId, provider, modelId }: ComposerProps) {
  const [text, setText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { send, isPending, error } = useSendMessage()

  const canSend = text.trim().length > 0 && !isPending

  async function submit() {
    if (!canSend) return

    const sent = await send({ conversationId, text, provider, modelId })
    // Only clear on success. A refusal must not cost the person their message.
    if (sent) {
      setText('')
      resetHeight()
    }
  }

  function resetHeight() {
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
    void submit()
  }

  return (
    <div className="mx-auto w-full max-w-180 px-lg pb-lg">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
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

        <div className="flex items-center justify-end gap-sm pt-xs">
          <Button
            type="submit"
            variant="primary"
            size="icon"
            disabled={!canSend}
            aria-label="Send message"
          >
            <ArrowUpIcon />
          </Button>
        </div>
      </form>

      {error && (
        <p role="alert" className="pt-xs text-body-sm text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
