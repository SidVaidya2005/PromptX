'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'

import { MoreHorizontalIcon, PinIcon } from 'lucide-react'

import { MAX_TITLE_LENGTH } from '@/lib/constants'
import { cn } from '@/lib/utils'

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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { useConversationMutation } from '@/components/sidebar/use-conversation-mutation'

type ConversationRowProps = {
  id: string
  title: string
  /** The raw timestamp, for <time datetime>. Machine-readable, unlike the label. */
  updatedAt: string
  /** Already formatted on the server, so nothing here depends on the clock. */
  relativeTime: string
  /** Non-null means pinned. The value is not read here — only its nullness. (F21) */
  pinnedAt: string | null
}

/**
 * The trailing slot holds two things that are never shown together on a fine
 * pointer: the timestamp at rest, the overflow trigger on hover or focus.
 *
 * They are stacked in one grid cell rather than given a slot each, so the title
 * keeps its full width and its truncation point never moves. On a coarse pointer
 * there is no hover to swap them with, so the container becomes a flex row and
 * both are simply visible — grid placement properties are inert on a flex item,
 * which is why the same two children work in both modes.
 */
const SLOT = 'grid shrink-0 items-center justify-items-end pointer-coarse:flex pointer-coarse:gap-xs'
const STACKED = 'col-start-1 row-start-1'

/**
 * Every rule below is scoped to `pointer-fine`, and the default — both visible —
 * is what a coarse pointer gets. Written the other way round first, as
 * `pointer-coarse:opacity-100` overriding an unscoped `group-hover:opacity-0`,
 * and it failed on a real touch viewport: emulated touch still matches `:hover`
 * for the last-tapped element, and between two single-class rules the later one
 * in the stylesheet wins. The timestamp measured `opacity: 0` at 360px with
 * `pointer: coarse`, which is the exact "unreachable without hover" defect
 * DESIGN.md forbids.
 *
 * Defaulting to visible and letting only fine pointers hide things is the safe
 * direction: a variant that fails to match now leaves a control reachable
 * rather than stranded.
 */
const TIME_REVEAL =
  'transition-opacity ' +
  'pointer-fine:group-hover:opacity-0 pointer-fine:group-focus-within:opacity-0 ' +
  'pointer-fine:group-has-[[data-state=open]]:opacity-0'

/**
 * The inverse. `pointer-events-none` while hidden matters: an invisible trigger
 * stacked over the timestamp would otherwise swallow clicks meant for the row.
 * Focus is unaffected by it, so the keyboard still reaches this.
 */
const TRIGGER_REVEAL =
  'transition-opacity ' +
  'pointer-fine:opacity-0 pointer-fine:pointer-events-none ' +
  'pointer-fine:group-hover:opacity-100 pointer-fine:group-hover:pointer-events-auto ' +
  'pointer-fine:group-focus-within:opacity-100 pointer-fine:group-focus-within:pointer-events-auto ' +
  'pointer-fine:data-[state=open]:opacity-100 pointer-fine:data-[state=open]:pointer-events-auto'

/**
 * One conversation. The only part of the list that ships to the browser.
 *
 * It is a Client Component for one reason: a layout cannot read the params of a
 * child segment, so the sidebar has no way to learn which conversation is open
 * except from the URL. usePathname() is that route — the same mechanism AppShell
 * already uses to close the mobile drawer on navigation. That same value decides
 * whether deleting this row has to navigate away from it.
 *
 * The `group` sits on the <li>, not on the <Link>. It has to: the overflow
 * trigger is a button, and a button inside an anchor is invalid. That also means
 * `group-focus-within` rather than `group-focus-visible` — the latter only fires
 * when the group element is itself focused, which stopped being true the moment
 * focus could land on a descendant.
 *
 * Everything else — the query, the grouping, the time formatting — stays on the
 * server and arrives as props.
 */
export function ConversationRow({
  id,
  title,
  updatedAt,
  relativeTime,
  pinnedAt,
}: ConversationRowProps) {
  const router = useRouter()
  const isActive = usePathname() === `/chat/${id}`
  const isPinned = pinnedAt !== null

  const [confirming, setConfirming] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(title)
  const inputRef = useRef<HTMLInputElement>(null)

  /**
   * Escape has to be able to beat the blur that follows it. Unmounting the input
   * moves focus, and without this the blur handler would commit the very edit
   * the user just cancelled — the two events say opposite things about the same
   * keystroke, and only their order distinguishes them.
   *
   * **Cleared where the rename starts, not only where the blur reads it**, and
   * that was a real bug rather than belt-and-braces. React fires no blur for an
   * element it unmounts, so a cancelled rename left this stuck at true — and the
   * *next* rename on the same row silently discarded its own blur commit. Seen
   * in the browser: the input kept the typed title on screen and the database
   * never heard about it.
   */
  const cancelledRef = useRef(false)

  /** One commit per rename, however many events ask for it. */
  const committingRef = useRef(false)

  /**
   * Radix returns focus to the trigger when the menu closes, which would take it
   * straight back off the input we are about to show. This says "the close is a
   * rename starting" so `onCloseAutoFocus` can decline.
   */
  const startingRenameRef = useRef(false)

  const { rename, setPinned, error: mutationError } = useConversationMutation()

  /**
   * Escape cancels the rename, and this is why it is a window listener rather
   * than the input's own `onKeyDown`.
   *
   * Below 1024px the sidebar is a Radix Sheet, and Radix dismisses it from
   * `document.addEventListener('keydown', …, { capture: true })` — measured in
   * `@radix-ui/react-use-escape-keydown`, not assumed. Document capture runs
   * before React's root listener, so `stopPropagation()` inside a React handler
   * is already too late: the first version did exactly that and the drawer
   * closed along with the rename, taking the whole sidebar with it.
   *
   * `window` is one step above `document` in the capture path, so a listener
   * here sees the key first. `stopImmediatePropagation()` is what keeps it from
   * reaching Radix at all.
   */
  useEffect(() => {
    if (!renaming) return

    function handleEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return

      event.stopImmediatePropagation()

      // Beats the blur that follows, which would otherwise commit the edit the
      // user just cancelled.
      cancelledRef.current = true
      setRenaming(false)
      setDraft(title)
    }

    window.addEventListener('keydown', handleEscape, { capture: true })
    return () => window.removeEventListener('keydown', handleEscape, { capture: true })
  }, [renaming, title])

  function startRename() {
    setDraft(title)
    setError(null)
    cancelledRef.current = false
    committingRef.current = false
    startingRenameRef.current = true
    setRenaming(true)
  }

  async function commitRename() {
    if (committingRef.current) return

    const next = draft.trim()

    // Nothing to say to the server: an empty title is the schema's floor, and an
    // unchanged one would spend a round trip to write what is already there.
    if (next === '' || next === title) {
      setRenaming(false)
      setDraft(title)
      return
    }

    committingRef.current = true

    try {
      // Left open on failure. The typed title only exists in this input, and
      // closing would be the one action that loses it.
      if (await rename(id, next)) setRenaming(false)
    } finally {
      committingRef.current = false
    }
  }

  async function handlePin(next: boolean) {
    setError(null)
    await setPinned(id, next)
  }

  async function handleDelete() {
    setIsDeleting(true)
    setError(null)

    try {
      const response = await fetch(`/api/conversations/${id}`, { method: 'DELETE' })

      if (!response.ok) {
        setError('Could not delete this conversation. Try again.')
        setIsDeleting(false)
        return
      }

      setConfirming(false)

      // Only when the deleted conversation is the one on screen. `replace`, not
      // `push` — a history entry pointing at a conversation that no longer
      // exists would back-button straight into a 404.
      if (isActive) router.replace('/chat')

      // The sidebar's query lives in the (app) layout, which Next preserves
      // across navigation. Without this the row stays until something else
      // happens to refresh it.
      router.refresh()
    } catch {
      setError('Network error. Try again.')
      setIsDeleting(false)
    }
  }

  // The delete dialog carries its own copy, so only a rename or pin failure
  // belongs beneath the row.
  const rowError = confirming ? null : mutationError

  return (
    <li
      className={cn(
        'group relative flex flex-col rounded-sm text-body-sm',
        isActive
          ? 'bg-canvas-soft text-ink'
          : // The fill lives here rather than on the link, so hovering the
            // trigger still lights the row — and so the row does not go dark
            // while its own menu is open and the pointer has moved away to it.
            'text-body-strong hover:bg-canvas-soft has-[[data-state=open]]:bg-canvas-soft',
      )}
    >
      {isActive && (
        <span aria-hidden className="absolute inset-y-xs left-0 w-0.5 bg-primary" />
      )}

      <div
        className={cn(
          'flex items-center gap-sm pr-xs',
          // The 44px floor keys off pointer type, never off a breakpoint.
          'pointer-coarse:min-h-11',
        )}
      >
        {isPinned && !renaming && (
          // A glyph rather than DESIGN.md's status-chip: the chip's fill is
          // canvas-soft and so is this row's hover and active fill, so a
          // "Pinned" chip would disappear exactly when the row is being used.
          // Nothing is announced here — the enclosing <ul aria-label="Pinned">
          // already tells a screen reader which group this row is in.
          <PinIcon aria-hidden className="ml-md size-3 shrink-0 text-mute" />
        )}

        {renaming ? (
          <Input
            ref={inputRef}
            value={draft}
            maxLength={MAX_TITLE_LENGTH}
            aria-label={`Rename ${title}`}
            // 36px, which is py-sm twice plus the 20px line-height — the same
            // height the link occupies, so the row does not jump on rename.
            className="ml-md min-w-0 flex-1"
            onChange={(event) => setDraft(event.target.value)}
            // Enter only. Escape is handled above, from a window listener that
            // has to see the key before Radix's dismissal does.
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return

              event.preventDefault()
              void commitRename()
            }}
            onBlur={() => {
              if (cancelledRef.current) {
                cancelledRef.current = false
                return
              }

              void commitRename()
            }}
          />
        ) : (
          /* The ::after overlay is what keeps the whole row clickable now that
             the link no longer wraps it. Without it the target shrinks to the
             width of the title text, and the empty space beside a short title
             stops working — which it did before this feature. */
          <Link
            href={`/chat/${id}`}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'min-w-0 flex-1 truncate py-sm after:absolute after:inset-0',
              // The pin glyph brings the leading gutter with it when it is there.
              isPinned ? 'pl-0' : 'pl-md',
            )}
          >
            {title}
          </Link>
        )}

        <div className={SLOT}>
          {/* pointer-events-none is load-bearing, not tidiness. The timestamp is
              inline text stacked in the same grid cell as the trigger, and inline
              content paints above a non-positioned sibling's box — so it wins the
              hit test and swallows the click meant for the button underneath it.
              Measured: elementFromPoint at the trigger's centre returned TIME. */}
          <time
            dateTime={updatedAt}
            className={cn(STACKED, 'pointer-events-none text-caption text-mute', TIME_REVEAL)}
          >
            {relativeTime}
          </time>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                // Named, because a screen reader hearing "More options" twenty
                // times over cannot tell which conversation any of them belongs to.
                aria-label={`Options for ${title}`}
                // relative z-10 lifts it above the link's ::after overlay, which
                // otherwise covers the whole row including this.
                className={cn(STACKED, 'relative z-10 size-7', TRIGGER_REVEAL)}
              >
                <MoreHorizontalIcon />
              </Button>
            </DropdownMenuTrigger>

            <DropdownMenuContent
              align="end"
              /**
               * Where the rename input gets its focus, and it has to be here.
               *
               * The obvious version — an effect keyed on `renaming` — was
               * written first and measured not to work: the input mounts while
               * the menu is still open, and Radix's FocusScope is trapped, so it
               * pulls focus straight back out. The input rendered with the right
               * value and `document.activeElement` was `BODY`.
               *
               * This runs after that scope has released, which is the first
               * moment the focus can stick. `preventDefault()` is what stops
               * Radix returning focus to the trigger instead.
               *
               * Never `autoFocus`: below 1024px this component is in the
               * document twice — the desktop <aside> is `display:none` but still
               * mounted while the drawer copy renders — and a browser-driven
               * focus is not a thing this component would get to decide.
               *
               * `select()` because a rename usually replaces the title rather
               * than appending to it.
               */
              onCloseAutoFocus={(event) => {
                if (!startingRenameRef.current) return

                startingRenameRef.current = false
                event.preventDefault()

                inputRef.current?.focus()
                inputRef.current?.select()
              }}
            >
              <DropdownMenuItem onSelect={startRename}>Rename</DropdownMenuItem>

              {/* Desired state, not a toggle: the label already says which one
                  this click means. */}
              <DropdownMenuItem onSelect={() => void handlePin(!isPinned)}>
                {isPinned ? 'Unpin' : 'Pin'}
              </DropdownMenuItem>

              <DropdownMenuItem variant="danger" onSelect={() => setConfirming(true)}>
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {rowError && (
        <p role="alert" className="px-md pb-xs text-caption text-danger">
          {rowError}
        </p>
      )}

      {/* A sibling of the menu, never a child of it: DropdownMenuContent
          unmounts when the menu closes, and a dialog inside it would go too. */}
      <AlertDialog
        open={confirming}
        onOpenChange={(next) => {
          if (isDeleting) return
          setConfirming(next)
          if (!next) setError(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete conversation?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="break-words text-body-strong">{title}</span> and every
              message in it will be deleted. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {error && (
            <p role="alert" className="text-body-sm text-danger">
              {error}
            </p>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isDeleting}
              // Radix closes the dialog on click by default. It has to stay open
              // while the request is in flight, and stay open to show an error.
              onClick={(event) => {
                event.preventDefault()
                void handleDelete()
              }}
            >
              {isDeleting ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  )
}
