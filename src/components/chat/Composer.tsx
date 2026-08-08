'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'

import { ArrowUpIcon, PaperclipIcon, SquareIcon } from 'lucide-react'

import { SHARED_KEY_DAILY_MESSAGE_LIMIT } from '@/lib/constants'
import {
  acceptedMimeTypes,
  findModel,
  willUseSharedKey,
} from '@/lib/models'
import { insertPromptAt } from '@/lib/prompts'
import { cn } from '@/lib/utils'

import { AttachmentChip } from '@/components/chat/AttachmentChip'
import { ModelPicker } from '@/components/chat/ModelPicker'
import { PromptPicker } from '@/components/chat/PromptPicker'
import { QuotaMeter } from '@/components/chat/QuotaMeter'
import { SystemPromptControl } from '@/components/chat/SystemPromptControl'
import { useAttachmentUploads } from '@/components/chat/use-attachment-uploads'
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

import type { Provider, RenderedAttachment } from '@/types/domain'

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
  onSend: (text: string, attachments: readonly RenderedAttachment[]) => void
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
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)

  /**
   * What the selected model will read, and the only thing that decides it. (F30)
   *
   * Four surfaces downstream of this one call: the attach button's state, the
   * file input's `accept`, the hook's own rejection of a dropped file, and the
   * warning before a model change drops what it cannot read. The server asks the
   * same function about the rows, which is the enforcement.
   */
  const accepted = acceptedMimeTypes(provider, modelId)
  const acceptsNothing = accepted.length === 0
  const modelLabel = findModel(provider, modelId)?.label ?? modelId

  const attachments = useAttachmentUploads({ accepted, modelLabel })

  /** A model change waiting on confirmation, because it would drop files. */
  const [pendingModel, setPendingModel] = useState<{
    provider: Provider
    modelId: string
    label: string
    casualties: string[]
  } | null>(null)

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

  /**
   * An unfinished or failed upload blocks the send rather than being dropped
   * from it. (F29)
   *
   * §29 is explicit that a failed upload "blocks send with a clear message
   * rather than sending without it". Sending the message minus the file somebody
   * attached to it is the one outcome that would look like the application
   * working — the answer would simply be about the wrong thing.
   *
   * The server refuses the same request independently, on the rows rather than
   * on this state, so this is the affordance agreeing with the rule rather than
   * being it.
   */
  const waitingOnUploads = attachments.isUploading || attachments.hasFailed

  const canSend =
    text.trim().length > 0 && !isStreaming && !blocked && !waitingOnUploads

  function submit() {
    if (!canSend) return

    // The ready rows in chip order, which is the order they will be linked in
    // and the order they will render in — `position` comes from this array.
    onSend(text, attachments.readyAttachments)
    setText('')
    attachments.clear()

    const textarea = textareaRef.current
    if (textarea) textarea.style.height = 'auto'
  }

  /**
   * Applies a model choice, asking first when it would cost somebody a file. (F30)
   *
   * Only the *incompatible* attachments are at risk, which is the per-file-type
   * gate followed through: switching to a model that reads images but not PDFs
   * with one of each drops the PDF and keeps the image. Anything coarser would
   * take a file the new model was perfectly happy with.
   *
   * "Dropped" means deleted — the row and all three of its objects, through the
   * same path the chip's own remove control takes. A file left in Storage that
   * nothing points at is the leak F28 built a reaper for.
   */
  function requestModelChange(nextProvider: Provider, nextModelId: string) {
    const nextAccepted = acceptedMimeTypes(nextProvider, nextModelId)
    const casualties = attachments.items.filter(
      (item) => !nextAccepted.includes(item.mimeType),
    )

    if (casualties.length === 0) {
      onSelectModel(nextProvider, nextModelId)
      return
    }

    setPendingModel({
      provider: nextProvider,
      modelId: nextModelId,
      label: findModel(nextProvider, nextModelId)?.label ?? nextModelId,
      casualties: casualties.map((item) => item.localId),
    })
  }

  function confirmModelChange() {
    if (!pendingModel) return

    for (const localId of pendingModel.casualties) attachments.remove(localId)

    onSelectModel(pendingModel.provider, pendingModel.modelId)
    setPendingModel(null)
  }

  function chooseFiles(list: FileList | null) {
    if (!list || list.length === 0) return

    attachments.add(Array.from(list))

    // Cleared so choosing the SAME file again still fires a change event. An
    // input that keeps its value is silent on the second attempt, which reads as
    // the button being broken.
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function handleChange(event: React.ChangeEvent<HTMLTextAreaElement>) {
    setText(event.target.value)
    resize(event.target)
  }

  /**
   * Inserts a saved prompt's body at the caret. (F25)
   *
   * The DOM is read for the selection rather than React state tracking it: the
   * textarea is the only thing that knows where the caret is, and mirroring that
   * into state would mean an update per keystroke and per click for a value read
   * once per insertion.
   *
   * Everything after the write is deferred to the next frame because React has
   * not re-rendered yet — setting `selectionStart` against the old value would
   * clamp to the old length, and `scrollHeight` would measure the old text. The
   * resize in particular is why this feature needed `resize()` extracted at all:
   * `handleChange` does not run for a programmatic write, so without this a
   * twelve-line prompt lands in a one-row box.
   */
  function insertPrompt(body: string) {
    const textarea = textareaRef.current
    if (!textarea) return

    const { text: next, caret } = insertPromptAt(
      text,
      textarea.selectionStart,
      textarea.selectionEnd,
      body,
    )

    setText(next)

    requestAnimationFrame(() => {
      const current = textareaRef.current
      if (!current) return

      // Focus first: the caret is only meaningful in a focused field, and focus
      // is on the picker's search input at this point.
      current.focus()
      current.setSelectionRange(caret, caret)
      resize(current)
    })
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

      {/* A rejection never becomes a chip, so it has nowhere else to be said.
          Above the composer with the quota sentences, for the same reason: it is
          a sentence, not a control. */}
      {attachments.error && (
        <p role="status" className="pb-sm text-body-sm text-danger">
          {attachments.error}
        </p>
      )}

      {/* Why the send button is disabled, said out loud. A disabled control with
          no explanation is the version of this that gets reported as a bug. The
          quota sentences win when both apply — they are the harder wall. */}
      {!blocked && attachments.hasFailed && (
        <p role="status" className="pb-sm text-body-sm text-danger">
          One of those files didn&rsquo;t upload. Retry it or remove it to send.
        </p>
      )}

      {!blocked && !attachments.hasFailed && attachments.isUploading && (
        <p role="status" className="pb-sm text-body-sm text-mute">
          Waiting for your files to finish uploading&hellip;
        </p>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
        // Drag-and-drop is scoped to the composer rather than the window. A
        // page-wide drop zone would swallow drags meant for anything else, and
        // the thread above is a scrolling surface people drag on already.
        onDragOver={(event) => {
          if (blocked) return

          // Both of these are required for a drop to fire at all: the default
          // action for a dragover is "refuse the drop", so not preventing it
          // means onDrop never runs and the browser navigates to the file.
          event.preventDefault()
          setIsDragging(true)
        }}
        onDragLeave={(event) => {
          // Only when the pointer has actually left the form. Dragging across a
          // child fires dragleave on the parent, which would otherwise flicker
          // the highlight the entire way in.
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return

          setIsDragging(false)
        }}
        onDrop={(event) => {
          event.preventDefault()
          setIsDragging(false)

          if (!blocked) chooseFiles(event.dataTransfer.files)
        }}
        className={cn(
          // DESIGN.md `composer`: canvas-soft fill, hairline border, rounded-md,
          // 10px padding, and the border brightening to mute on focus-within.
          'rounded-md border border-hairline bg-canvas-soft p-md transition-colors',
          'focus-within:border-mute',
          // The drop state reuses the focus treatment rather than introducing a
          // colour. DESIGN.md has no token for "a file is over this", and the
          // state-only tokens are reserved for things going wrong.
          isDragging && 'border-mute',
        )}
      >
        {attachments.items.length > 0 && (
          <ul className="flex flex-wrap gap-sm pb-sm">
            {attachments.items.map((item) => (
              <AttachmentChip
                key={item.localId}
                attachment={item}
                onRemove={attachments.remove}
                onRetry={attachments.retry}
              />
            ))}
          </ul>
        )}

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
            {/* DESIGN.md's `composer-toolbar` names the attach button, and this
                is it. The input is the real control and the button is its
                label — a bare file input cannot be styled to this system, and
                wrapping it in a <label> would lose the keyboard behaviour a
                button already has. */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              // Narrowed to what THIS model reads, not to what PromptX allows.
              // It only filters the file chooser — a drop bypasses it entirely,
              // which is why the hook checks the mime again and the server
              // checks the rows after that. (F30)
              accept={accepted.join(',')}
              onChange={(event) => chooseFiles(event.target.files)}
              className="hidden"
              tabIndex={-1}
              aria-hidden
            />

            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    // Mid-stream for the same reason as the controls beside it:
                    // the request in flight cannot gain an attachment, and
                    // offering it would imply otherwise.
                    disabled={isStreaming || blocked}
                    /**
                     * `aria-disabled` rather than `disabled` for the capability
                     * case, and the difference is the whole tooltip. (F30)
                     *
                     * A disabled button fires no pointer events, so Radix never
                     * sees a hover and the tooltip explaining WHY it is
                     * unavailable would be the one thing on screen nobody could
                     * reach. This keeps it focusable and hoverable while the
                     * click does nothing.
                     */
                    aria-disabled={acceptsNothing}
                    onClick={() => {
                      if (acceptsNothing) return
                      fileInputRef.current?.click()
                    }}
                    className={cn(acceptsNothing && 'text-mute opacity-50')}
                    aria-label="Attach a file"
                  >
                    <PaperclipIcon />
                  </Button>
                </TooltipTrigger>

                {/* Only when there is something to explain. A tooltip that
                    repeats the button's own label is noise on every hover. */}
                {acceptsNothing && (
                  <TooltipContent>
                    {/* `{' '}` rather than a literal space, because the literal
                        one did not survive: the DOM read
                        "DeepSeek V4 Flashcan't read files" with the source
                        plainly showing a space between the expression and the
                        text. Measured in the browser, not reasoned about. */}
                    {modelLabel}
                    {' '}
                    can&rsquo;t read files. Pick another model to attach one.
                  </TooltipContent>
                )}
              </Tooltip>
            </TooltipProvider>

            <ModelPicker
              provider={provider}
              modelId={modelId}
              configuredProviders={configuredProviders}
              // Choosing mid-stream cannot affect the request already in flight,
              // and offering it would imply otherwise.
              disabled={isStreaming}
              onSelect={requestModelChange}
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

            {/* Disabled mid-stream on the same terms as the two controls above,
                and for a slightly different reason: inserting text into the
                draft would work fine, but the draft cannot be sent until the
                stream ends, so offering it invites typing into a box that will
                not accept Enter. */}
            <PromptPicker disabled={isStreaming || blocked} onInsert={insertPrompt} />

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

      {/* An AlertDialog rather than a Dialog, per the rule F11 established: it
          carries role="alertdialog", drops outside-click dismissal, and focuses
          Cancel rather than the button that destroys something. Mounted only
          while open, per F24 — Radix calls onOpenChange only for changes it
          initiates, so a dialog left mounted with an `open` prop never hears
          about a parent opening it. */}
      {pendingModel && (
        <AlertDialog open onOpenChange={(open) => !open && setPendingModel(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Switch to {pendingModel.label}?
              </AlertDialogTitle>
              <AlertDialogDescription>
                It can&rsquo;t read{' '}
                <span className="text-body-strong">
                  {pendingModel.casualties.length}{' '}
                  {pendingModel.casualties.length === 1 ? 'file' : 'files'}
                </span>{' '}
                you&rsquo;ve attached, so {pendingModel.casualties.length === 1
                  ? 'it'
                  : 'they'}{' '}
                will be removed. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>

            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={confirmModelChange}>
                Switch and remove
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  )
}

/**
 * Grows the textarea to fit its content, capped by the CSS max-height.
 *
 * Extracted at F25 because it now has two callers. It used to be three lines
 * inside `handleChange`, which is the one path a programmatic write does not
 * take — so inserting a saved prompt grew the value and not the box.
 *
 * Collapsing before measuring is the load-bearing half: `scrollHeight` only ever
 * reports the tallest the element has been, so without the reset the textarea
 * can grow and never shrink.
 */
function resize(textarea: HTMLTextAreaElement): void {
  textarea.style.height = 'auto'
  textarea.style.height = `${textarea.scrollHeight}px`
}
