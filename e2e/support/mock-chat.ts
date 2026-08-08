import { createServer, type Server } from 'node:http'
import type { Page } from '@playwright/test'

/**
 * A canned assistant answer, delivered as a real stream.
 *
 * **Why a server rather than `route.fulfill()`.** `library-docs.md` says provider
 * calls are intercepted with `page.route()`, which cannot be literally true —
 * `streamText` runs inside `/api/chat` on the server and the browser never
 * contacts a provider — so what is intercepted is the application's own route.
 * The obvious way to do that is `route.fulfill({ body })`, and it is wrong here
 * for a specific reason: fulfil sends the whole body at once, so the client
 * receives one chunk and the spec cannot tell an incremental render from a
 * single blob. A test for streaming that would pass identically without
 * streaming is the decorative-mechanism failure this project keeps recording.
 *
 * So the route is redirected with `route.continue({ url })` to a local server
 * that writes SSE frames with real gaps between them. Measured before it was
 * relied on: five separate chunks arrive at the browser.
 *
 * The frame shape is read off the installed `ai@7.0.44` rather than remembered —
 * `text-start` / `text-delta` / `text-end`, terminated by `data: [DONE]`, with
 * the `x-vercel-ai-ui-message-stream: v1` header the transport looks for. The
 * standing rule for this package: read the `.d.ts`, not the docs.
 */

export type MockChat = {
  /** How many times the intercepted route was actually served. */
  readonly hits: () => number
  close: () => Promise<void>
}

type Options = {
  /** Delivered one delta at a time, in order. */
  words?: string[]
  /** Gap between deltas. Long enough that a poll can catch an intermediate state. */
  delayMs?: number
}

const DEFAULT_WORDS = ['Objects ', 'first, ', 'then the rows.']

function frame(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`
}

/**
 * Starts the mock and points the page's `/api/chat` at it.
 *
 * The returned `hits()` is not bookkeeping: an interception that never fires is
 * a spec quietly reaching the real server, which would spend a quota slot and,
 * on the shared key, real money. Every spec asserts on it.
 */
export async function mockChatStream(page: Page, options: Options = {}): Promise<MockChat> {
  const words = options.words ?? DEFAULT_WORDS
  const delayMs = options.delayMs ?? 300

  let hits = 0

  const server: Server = createServer((request, response) => {
    // The redirect is cross-origin — a different port is a different origin — so
    // the browser preflights a POST carrying `content-type: application/json`.
    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': '*',
      })
      response.end()
      return
    }

    hits += 1

    response.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'x-vercel-ai-ui-message-stream': 'v1',
      'access-control-allow-origin': '*',
    })

    response.write(frame({ type: 'start' }))
    response.write(frame({ type: 'text-start', id: 't0' }))

    let index = 0

    const timer = setInterval(() => {
      const word = words[index]

      if (word !== undefined) {
        response.write(frame({ type: 'text-delta', id: 't0', delta: word }))
        index += 1
        return
      }

      clearInterval(timer)
      response.write(frame({ type: 'text-end', id: 't0' }))
      response.write(frame({ type: 'finish' }))
      response.write('data: [DONE]\n\n')
      response.end()
    }, delayMs)
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))

  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('the mock chat server did not bind a port')
  }

  const url = `http://127.0.0.1:${address.port}/chat`

  // Port 0 rather than a fixed one: spec files run in parallel, and two suites
  // sharing a hardcoded port is the same collision F35 hit with two suites
  // sharing hardcoded uuids.
  await page.route('**/api/chat', (route) => route.continue({ url }))

  return {
    hits: () => hits,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
      }),
  }
}
