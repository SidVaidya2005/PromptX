'use client'

import { useEffect, useRef, useState } from 'react'

import type { ChatMessage } from '@/lib/messages'

type GenerationAnnouncerProps = {
  status: 'submitted' | 'streaming' | 'ready' | 'error'
  messages: readonly ChatMessage[]
}

/**
 * What a screen reader is told while an answer is being generated. (F37)
 *
 * **This is deliberately not a live region wrapped around the streaming text**,
 * which is the obvious reading of build-plan.md §37's "the thread is a live
 * region so streaming text is announced" and is unusable in practice. A polite
 * region re-announces whenever its contents change and **queues** rather than
 * replaces, so a message arriving as fifty deltas produces fifty announcements
 * the reader has to sit through before hearing anything else. The effect is a
 * screen reader talking over itself for the length of the response.
 *
 * So the region carries *state*, not tokens: that generation has started, and
 * then the answer once it has settled. Two announcements per turn, which is what
 * a person actually needs — something is happening, and here is the result. The
 * streaming text itself is marked `aria-busy` by the thread, so a reader who
 * navigates into it mid-stream is told it is still changing.
 *
 * Announcing the settled answer rather than "Response complete" is the other
 * half. The text is in the DOM to navigate either way, but a reader who has just
 * asked a question should not have to go looking for the reply — and the
 * announcement replaces itself on the next turn rather than accumulating.
 */
export function GenerationAnnouncer({ status, messages }: GenerationAnnouncerProps) {
  const [announcement, setAnnouncement] = useState('')

  // What the region said last, so an unrelated re-render cannot re-announce the
  // same sentence. React would otherwise write an identical string back into the
  // node and some readers treat any mutation as new.
  const lastSpoken = useRef('')

  useEffect(() => {
    function speak(next: string) {
      if (next === lastSpoken.current) return
      lastSpoken.current = next
      setAnnouncement(next)
    }

    if (status === 'submitted' || status === 'streaming') {
      speak('Generating response')
      return
    }

    if (status === 'error') {
      speak('The response failed')
      return
    }

    // `ready` is also the resting state of a thread nobody has sent anything to,
    // so an answer is only announced when one was actually being waited for.
    if (lastSpoken.current !== 'Generating response') return

    const latest = messages[messages.length - 1]
    if (latest?.role !== 'assistant') return

    const text = latest.parts
      .map((part) => (part.type === 'text' ? part.text : ''))
      .join('')
      .trim()

    speak(text.length > 0 ? `Response complete. ${text}` : 'Response complete')
  }, [status, messages])

  return (
    <p role="status" aria-live="polite" className="sr-only">
      {announcement}
    </p>
  )
}
