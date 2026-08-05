import { QUOTA_WARNING_THRESHOLD, SHARED_KEY_DAILY_MESSAGE_LIMIT } from '@/lib/constants'
import { cn } from '@/lib/utils'

type QuotaMeterProps = {
  /** Shared-key messages left today. Never rendered for a BYOK model. */
  remaining: number
}

/**
 * How much of today's shared allowance is left.
 *
 * Shown whenever the shared key would answer the next message, not only once the
 * allowance runs low. DESIGN.md describes the text as *shifting* to warn at the
 * threshold and danger at zero, which presupposes it was already on screen —
 * build-plan.md's "appearing at QUOTA_WARNING_THRESHOLD" would leave that shift
 * nothing to shift from, and a meter that materialises at exactly five reads as
 * an alarm rather than as a number the user could have been watching.
 *
 * **Deviation from DESIGN.md, deliberately.** The spec gives this a
 * `canvas-soft` pill, and the composer it sits in is also `canvas-soft` — the
 * container would be invisible, which is the same trap F15 hit with
 * `status-chip` and solved the same way. Only the text is rendered. DESIGN.md's
 * own instruction that "the container never changes colour — only the text does"
 * survives this intact; there is simply no container.
 */
export function QuotaMeter({ remaining }: QuotaMeterProps) {
  const exhausted = remaining <= 0

  return (
    <p
      className={cn(
        'text-caption',
        exhausted
          ? 'text-danger'
          : remaining <= QUOTA_WARNING_THRESHOLD
            ? 'text-warn'
            : 'text-mute',
      )}
      // Only the count changes as messages are sent, and a screen reader that
      // announced the whole composer on every send would be unusable. `polite`
      // waits for a pause; `text` re-reads the sentence rather than the digit,
      // which on its own would be announced without saying what it counts.
      aria-live="polite"
      aria-atomic="true"
    >
      {exhausted
        ? `No free messages left today`
        : `${remaining} of ${SHARED_KEY_DAILY_MESSAGE_LIMIT} free messages left today`}
    </p>
  )
}
