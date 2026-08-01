'use client'

import { Component, type ReactNode } from 'react'

type MarkdownErrorBoundaryProps = {
  /**
   * The raw markdown. Doubles as the fallback body and as the signal to try
   * rendering again — see `componentDidUpdate`.
   */
  content: string
  children: ReactNode
}

type MarkdownErrorBoundaryState = {
  failed: boolean
}

/**
 * Keeps one bad message from taking out the thread.
 *
 * A streaming response is syntactically invalid most of the time it exists: an
 * unclosed fence, a half-written table row, a link with no closing bracket. The
 * markdown pipeline handles nearly all of that, and this exists for the case
 * where it does not — because the alternative is a render-phase throw that
 * unmounts everything up to the nearest boundary, and the nearest boundary is
 * `error.tsx` at the route group. One malformed token would blank the entire
 * workspace, sidebar included.
 *
 * The fallback is the raw markdown, not an apology. Whatever the model said is
 * still readable as text, which is worse than rendered and far better than an
 * empty box where a response used to be.
 *
 * This has to be a class component. `getDerivedStateFromError` has no hook
 * equivalent in React 19, and pulling in `react-error-boundary` for one
 * lifecycle method would not pass the dependency gate in code-standards.md.
 */
export class MarkdownErrorBoundary extends Component<
  MarkdownErrorBoundaryProps,
  MarkdownErrorBoundaryState
> {
  override state: MarkdownErrorBoundaryState = { failed: false }

  static getDerivedStateFromError(): MarkdownErrorBoundaryState {
    return { failed: true }
  }

  /**
   * Recovery is the whole point of this method.
   *
   * Without it, a fragment that throws mid-stream leaves the message showing
   * raw markdown permanently, even though the very next delta closes the fence
   * and parses cleanly. New content means a new attempt.
   */
  override componentDidUpdate(previous: MarkdownErrorBoundaryProps) {
    if (this.state.failed && previous.content !== this.props.content) {
      this.setState({ failed: false })
    }
  }

  override componentDidCatch(error: unknown) {
    console.error('[chat] markdown render failed, falling back to plain text', error)
  }

  override render() {
    if (this.state.failed) {
      return <div className="whitespace-pre-wrap">{this.props.content}</div>
    }

    return this.props.children
  }
}
