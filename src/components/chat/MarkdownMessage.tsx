'use client'

import { memo, useMemo } from 'react'

import Markdown, { type Components, type ExtraProps } from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { CodeBlock } from '@/components/chat/CodeBlock'

type MarkdownMessageProps = {
  content: string
  isStreaming: boolean
}

/**
 * The hast element react-markdown hands a component override.
 *
 * Taken from react-markdown's own props rather than by importing `hast`
 * directly: `@types/hast` is a transitive dependency here, and reaching past
 * the package that owns it would mean adding a dependency to name a type that
 * is already on the table.
 */
type HastElement = NonNullable<ExtraProps['node']>

/**
 * Pulls the text and the language out of the `<code>` inside a `<pre>`.
 *
 * Working from the hast node rather than from React children is what makes a
 * bare ```` ``` ```` fence work. Branching on `className` — the shape in
 * library-docs.md, and in most examples online — only sees a fence that named
 * its language; an unlabelled one arrives with no class at all and would render
 * as inline code, mid-paragraph, in the middle of a response.
 */
function readFence(
  node: HastElement | undefined,
): { code: string; language: string } | null {
  const child = node?.children.find(
    (item) => item.type === 'element' && item.tagName === 'code',
  )

  if (!child || child.type !== 'element') return null

  const className = child.properties?.className
  const classes = Array.isArray(className) ? className.map(String) : []
  const language = classes.find((name) => name.startsWith('language-'))?.slice(9) ?? ''

  const code = child.children
    .filter((item) => item.type === 'text')
    .map((item) => item.value)
    .join('')

  return { code: code.replace(/\n$/, ''), language }
}

/**
 * A response body, rendered.
 *
 * Raw HTML is off, and stays off. `rehype-raw` is the one plugin that must
 * never appear here: model output is attacker-influenceable — anyone can ask a
 * model to emit a `<script>` — so react-markdown's default of treating HTML as
 * text is the boundary, not a formatting preference.
 *
 * Only three elements are overridden, because only three carry behaviour. The
 * other fifteen are styled by `.markdown-body` in globals.css, which keeps this
 * file about what markdown *does* rather than what it looks like.
 */
function MarkdownMessageImpl({ content, isStreaming }: MarkdownMessageProps) {
  const components = useMemo<Components>(
    () => ({
      // Fenced code is intercepted here rather than at `code`, so `code` below
      // only ever sees the inline kind and needs no branch of its own. Note
      // that nothing is wrapped: returning CodeBlock's <div> from inside a
      // <pre> would be invalid HTML, so `pre` is replaced rather than filled.
      pre({ node, children }) {
        const fence = readFence(node)

        if (!fence) return <>{children}</>

        return (
          <CodeBlock
            code={fence.code}
            language={fence.language}
            isStreaming={isStreaming}
          />
        )
      },

      code({ children, ...props }) {
        return (
          <code
            {...props}
            className="rounded-xs bg-canvas-soft px-xs py-xxs font-mono text-code text-ink"
          >
            {children}
          </code>
        )
      },

      a({ children, ...props }) {
        return (
          <a
            {...props}
            target="_blank"
            rel="noopener noreferrer"
            className="text-ink underline underline-offset-2 hover:text-body-strong"
          >
            {children}
          </a>
        )
      },
    }),
    [isStreaming],
  )

  return (
    <div className="markdown-body">
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </Markdown>
    </div>
  )
}

/**
 * Memoised on content, so one message's delta does not reparse every other
 * message in the thread. A long conversation re-renders on every token
 * otherwise, and markdown parsing is the expensive part of that.
 */
export const MarkdownMessage = memo(MarkdownMessageImpl)
