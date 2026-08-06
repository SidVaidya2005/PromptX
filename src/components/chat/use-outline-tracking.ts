'use client'

import { useEffect, useState } from 'react'

import { outlineAnchorId, type OutlineEntry } from '@/lib/outline'

/**
 * Where the reading line sits inside the thread viewport.
 *
 * A bottom inset of 85% shrinks the observed band to the top 15% of the
 * container, so an anchor is "at the line" only while it is near the top edge.
 * That band is what turns geometry into a reading position: everything at or
 * above it has been reached, everything below it has not.
 */
const READING_LINE_MARGIN = '0px 0px -85% 0px'

/** An anchor's position relative to the reading band, as last reported. */
type AnchorPosition = {
  atLine: boolean
  above: boolean
}

/**
 * Which exchange the reader is currently inside.
 *
 * The rule is *the last prompt at or above the reading line*, which is not the
 * same as the topmost visible prompt and is the only version that survives a
 * long answer. A 2,000-word response pushes its own prompt off the top of the
 * viewport while the reader is still very much inside that exchange; keying off
 * visibility alone would advance the marker to the next prompt at that moment,
 * which is exactly when it is most misleading.
 *
 * Position, not crossings. An earlier draft kept "the last anchor to cross the
 * line", which is correct scrolling down and wrong scrolling up: scrolling back
 * past a prompt leaves it as the most recent crossing even though the reader is
 * now above it. Recording where each anchor *is* — rather than what it last did
 * — is direction-independent, and `IntersectionObserver` delivers an initial
 * record for every observed target, so the picture is complete from the start.
 *
 * The hook lives beside `Chat` rather than beside the rail because the observer
 * needs the scroll container as its `root`, and `Chat` is what owns it.
 */
export function useOutlineTracking(
  containerRef: React.RefObject<HTMLDivElement | null>,
  entries: readonly OutlineEntry[],
): string | null {
  const [activeId, setActiveId] = useState<string | null>(null)

  useEffect(() => {
    const container = containerRef.current

    if (!container || entries.length === 0) {
      setActiveId(null)
      return
    }

    const anchors = entries
      .map((entry) => document.getElementById(outlineAnchorId(entry.id)))
      .filter((anchor): anchor is HTMLElement => anchor !== null)

    if (anchors.length === 0) return

    const positions = new Map<string, AnchorPosition>()

    // The observer can fire several times in one scroll, and a fast flick can
    // pass three anchors before a frame is painted. Coalescing into a single
    // rAF is the throttle: at most one state write per frame, and only when the
    // answer actually changed. A re-render per intersection would re-render the
    // rail, which below 1024px is in the document twice.
    let frame = 0

    function apply() {
      frame = 0

      let last: string | null = null

      for (const entry of entries) {
        const position = positions.get(outlineAnchorId(entry.id))
        if (position?.atLine || position?.above) last = entry.id
      }

      // Nothing has reached the line yet, which is the honest state at the top
      // of a thread. Falling back to the first entry beats an unmarked rail,
      // which reads as broken rather than as "you are at the beginning".
      const next = last ?? entries[0]?.id ?? null

      // The functional form reads the current value without capturing it, so
      // the observer never depends on the marker it sets. Returning the same
      // value is React's own bail-out, which is what makes this a no-op on the
      // vast majority of frames rather than a re-render per scroll tick.
      setActiveId((current) => (current === next ? current : next))
    }

    const observer = new IntersectionObserver(
      (records) => {
        for (const record of records) {
          // rootBounds is the band after rootMargin, not the container. An
          // anchor whose bottom has passed above it has been scrolled through.
          const lineTop = record.rootBounds?.top ?? 0

          positions.set(record.target.id, {
            atLine: record.isIntersecting,
            above: record.boundingClientRect.bottom <= lineTop,
          })
        }

        if (frame === 0) frame = requestAnimationFrame(apply)
      },
      { root: container, rootMargin: READING_LINE_MARGIN, threshold: 0 },
    )

    for (const anchor of anchors) observer.observe(anchor)

    return () => {
      if (frame !== 0) cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [containerRef, entries])

  return activeId
}
