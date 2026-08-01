'use client'

import { useEffect, useState } from 'react'

import { highlight, normaliseLanguage } from '@/lib/highlighter'

import { CopyButton } from '@/components/chat/CopyButton'

type CodeBlockProps = {
  code: string
  /** The fence's own label, shown verbatim even when we cannot highlight it. */
  language: string
  /** True while the message carrying this block is still being generated. */
  isStreaming: boolean
}

/**
 * A fenced code block: DESIGN.md's `code-block`.
 *
 * Highlighting waits until the message finishes. Two reasons, and the second is
 * the one that shows: re-tokenising a string that grows by a token at a time is
 * quadratic over a stream, and a half-written fence tokenises as whatever it
 * currently looks like — a string literal that has not been closed yet swallows
 * the rest of the block, then unswallows it a moment later. Nobody benefits
 * from watching that resolve.
 *
 * So a streaming block is plain monospace on the same chrome, and it gains
 * colour once. Everything else about it — the label, the copy button, the
 * geometry — is there the whole time.
 */
export function CodeBlock({ code, language, isStreaming }: CodeBlockProps) {
  const resolved = normaliseLanguage(language)
  const [html, setHtml] = useState<string | null>(null)

  useEffect(() => {
    if (isStreaming || !resolved) return

    let current = true

    highlight(code, resolved)
      .then((result) => {
        if (current) setHtml(result)
      })
      .catch(() => {
        // A grammar that fails to load leaves the plain rendering in place.
        // Unhighlighted code is still code; an empty block is not.
      })

    // Guards a resolve that lands after this block is gone, and after a new
    // delta has already superseded the text being highlighted.
    return () => {
      current = false
    }
  }, [code, resolved, isStreaming])

  return (
    // No margin of its own: `.markdown-body > * + *` already sets the block
    // rhythm, and a margin here would be added to it rather than replace it.
    <div className="overflow-hidden rounded-md border border-hairline bg-canvas-soft">
      <div className="flex items-center justify-between border-b border-hairline px-lg py-xs">
        <span className="font-mono text-caption text-mute">{language || 'text'}</span>
        <CopyButton value={code} label="Copy code" />
      </div>

      <div className="overflow-x-auto p-lg">
        <pre className="w-fit min-w-full font-mono text-code text-body-strong">
          {html ? (
            // Safe for exactly one reason: shiki HTML-escapes every token's
            // text, so the only markup in this string is spans shiki generated.
            // See the escaping test in tests/lib/highlighter.test.ts.
            <code dangerouslySetInnerHTML={{ __html: html }} />
          ) : (
            <code>{code}</code>
          )}
        </pre>
      </div>
    </div>
  )
}
