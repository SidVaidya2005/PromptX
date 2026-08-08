# Library Docs

> **Role:** Project-specific usage patterns for each third-party library.
> **Read the relevant section** before using a library.
> **Relates to:** covers the integrations in `architecture.md`; defers to MCP servers and skills first.

Project-specific usage patterns for every third party library in this project.
This file only covers how we use each library in **this** specific project —
rules, patterns, and constraints specific to PromptX.

Read the relevant section before implementing any feature that touches these
libraries.

---

## Before Using Any Library

Before implementing any feature that uses a third party library:

1. **Check the project instruction file** (`CLAUDE.md`) at the project root — it lists installed skills and how to use them. Skills contain up-to-date API docs and patterns specific to this codebase.
2. **Check for a docs MCP server** — Context7 (`resolve-library-id` → `query-docs`) or a library-specific one such as the Supabase MCP. Use it before anything below.
3. **Read this file** for project-specific patterns that override general library knowledge.

The order of authority is:

```
Context7 / docs MCP server → skills via CLAUDE.md → this file (project rules) → official docs via web search
```

**Never write an API shape from training-data memory.** Library APIs change
frequently and training data goes stale — a plausible-looking wrong signature
costs more than asking. If none of the sources above answers it, ask.

This project has both **Context7** (`resolve-library-id` → `query-docs`) and a
**Supabase MCP server** configured, plus the `supabase` skill. Use them.

---

## Vercel AI SDK v7 (`ai@^7`, `@ai-sdk/react@^4`)

**Check first:** Context7 → `/vercel/ai`, but **verify the version** — Context7's
index tops out around v6, so for v7-specific questions read
`https://ai-sdk.dev/docs/migration-guides/migration-guide-7-0` directly.

The API has moved twice. Three generations of snippet are circulating, and only
the third is correct here:

| Generation | Shape | Status |
| --- | --- | --- |
| v4 | `result.toDataStreamResponse()`, `useChat({ api, body })` | Long dead |
| v5–v6 | `result.toUIMessageStreamResponse()`, `result.fullStream` | Deprecated in v7, still runs with warnings |
| **v7 (ours)** | top-level `toUIMessageStream({ stream: result.stream })` + `createUIMessageStreamResponse()` | **Correct** |

The v7 change is that stream helpers became **stateless top-level functions**
rather than methods on the result, and `result.fullStream` was renamed
`result.stream`. If a snippet calls a `toUIMessageStream*` method *on the result
object*, it is pre-v7.

### Setup

Providers are never imported as singletons. Every model instance is created
per-request from a decrypted user key, through `resolveModel()` in
`src/server/providers.ts` (see `architecture.md` → Key Patterns).

```typescript
// The four factory functions. Only src/server/providers.ts calls these.
import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogle } from '@ai-sdk/google'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'

createOpenAI({ apiKey })('gpt-5')
createAnthropic({ apiKey })('claude-opus-5')
createGoogle({ apiKey })('gemini-3.6-flash')
createOpenRouter({ apiKey })('anthropic/claude-opus-5')
```

### Streaming a response from a route handler

```typescript
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  streamText,
  toUIMessageStream,
} from 'ai'

export const runtime = 'nodejs'
// No maxDuration — that is a Vercel directive. See STREAM_TIMEOUT_MS below.

const result = streamText({
  model,                                   // from resolveModel()
  system: systemPrompt,                    // conversation.system_prompt, may be undefined
  messages: await convertToModelMessages(messages),
  // Render permits a 100-minute request; this is what actually ends a stall.
  abortSignal: AbortSignal.timeout(STREAM_TIMEOUT_MS),
  onFinish: async ({ text, usage, finishReason }) => {
    // Persist here. This fires after the stream completes, on the server.
    await appendMessage({ /* … */ })
  },
})

return createUIMessageStreamResponse({
  stream: toUIMessageStream({ stream: result.stream }),
})
```

### Consuming the stream in the composer

```tsx
'use client'

import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import { useState } from 'react'

import type { Provider } from '@/types/domain'

type ThreadProps = {
  conversationId: string
  provider: Provider
  modelId: string
}

export function Thread({ conversationId, provider, modelId }: ThreadProps) {
  const [input, setInput] = useState('')

  const { messages, sendMessage, status, stop, regenerate, error } = useChat({
    id: conversationId,
    transport: new DefaultChatTransport({
      api: '/api/chat',
      // Send only the newest message plus the routing metadata. The server
      // already has the history, so re-uploading it every turn is waste.
      prepareSendMessagesRequest: ({ id, messages }) => ({
        body: {
          conversationId: id,
          message: messages[messages.length - 1],
          provider,
          modelId,
        },
      }),
    }),
  })

  const isBusy = status === 'submitted' || status === 'streaming'

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        if (!input.trim() || isBusy) return
        sendMessage({ text: input })
        setInput('')
      }}
    >
      {/* thread rendering elsewhere */}
    </form>
  )
}
```

**Rules:**

- The v7 result exposes `result.stream`, not `result.fullStream`. Pass it to the top-level `toUIMessageStream({ stream })`, never to a method on the result.
- **`onFinish` is a deprecated alias for `onEnd`.** Use `onEnd`, which carries `{ text, usage, totalUsage, finishReason, steps }`. `usage.inputTokens` and `usage.outputTokens` are `number | undefined` — store them as null rather than defaulting to zero, because feature 17's breaker is fed by measured usage only. (F08)
- **`onAbort` receives only `steps`, and a single-step generation stopped mid-flight has none.** To keep a partial answer you must accumulate it yourself in `onChunk`, guarding on `chunk.type === 'text-delta'` and reading `chunk.text`. Measured, not assumed: stopping with 1,250 characters on screen persisted an empty row. (F08)
- Compose the abort signal — `AbortSignal.any([AbortSignal.timeout(STREAM_TIMEOUT_MS), request.signal])` — or the browser's stop button hides the response while the provider keeps generating and billing. (F08)
- To hand a client something it does not know yet, such as the id of a conversation this request just created, wrap the response in `createUIMessageStream({ execute })`, `writer.write({ type: 'data-…', transient: true })`, then `writer.merge(toUIMessageStream({ stream: result.stream }))`. `transient` keeps it out of the message history. The client reads it through `useChat`'s `onData`. (F08)
- Request and response bodies are excluded from the result by default in v7. Opt in with `include: { requestBody: true, responseBody: true }` only if genuinely needed — and never for a request carrying a decrypted API key.
- Message content is in `message.parts`, not `message.content`. Always iterate `parts` and switch on `part.type` — a message can carry text, reasoning, and file parts.
- `status` is one of `'submitted' | 'streaming' | 'ready' | 'error'`. Derive the composer's disabled state and the stop button's visibility from it; do not track a separate `isLoading` boolean.
- `stop()` aborts the fetch and keeps the tokens already received. Persist that partial content with `status = 'error'` rather than discarding it.
- Use the hook's `regenerate()` for the regenerate feature rather than hand-rolling a re-send.
- `prepareSendMessagesRequest` is where the custom body goes. There is no top-level `body` option.
- Send **only** `messages[messages.length - 1]` as a singular `message` field. The server loads history from the database — this is a stated invariant, not an optimisation, because a client must not be able to rewrite its own past turns.
- Set `id: conversationId` on the hook so switching conversations gives each thread its own isolated state.
- `onFinish` on `streamText` runs on the server and is the only correct place to persist an assistant message. Never persist from the client after a stream — a closed tab loses the message.
- Every provider call is instantiated per-request inside `resolveModel()`. Never create a module-level provider instance: it would capture one user's key and serve it to another.
- **Ignore every `maxDuration` example in the AI SDK docs.** They assume Vercel. On Render the export does nothing, and the platform allows a 100-minute request — so nothing external will cut a hung provider connection. Bound it yourself by passing an `AbortSignal` built from `STREAM_TIMEOUT_MS` to `streamText`, and treat the abort as a stream failure (persist partial content, release the quota slot).

---

## Supabase (`@supabase/supabase-js`, `@supabase/ssr`)

**Check first:** the **Supabase MCP server** and the `supabase` skill, both
configured for this project. Then Context7 → `/supabase/ssr`. The MCP server can
read the live schema, apply migrations, and run advisors — prefer it over
guessing at SQL.

### Setup

Three clients exist and each has exactly one legitimate use. They are defined in
`architecture.md` → Key Patterns; do not create a fourth.

| Client | Where | RLS | Use for |
| ------ | ----- | --- | ------- |
| `createBrowserSupabaseClient()` | `src/lib/supabase-browser.ts` | Active | Sign-in redirect and realtime only |
| `createServerSupabaseClient()` | `src/server/supabase.ts` | Active | Everything else |
| `createServiceRoleClient()` | `src/server/supabase.ts` | **Bypassed** | `shared_key_budget` only, from `src/server/quota.ts` |

### Google Sign-In

```typescript
// Client Component — the landing page button
const supabase = createBrowserSupabaseClient()

await supabase.auth.signInWithOAuth({
  provider: 'google',
  options: {
    redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback?next=/chat`,
  },
})
```

```typescript
// src/app/auth/callback/route.ts
import { NextResponse } from 'next/server'

import { createServerSupabaseClient } from '@/server/supabase'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/chat'

  if (!code) return NextResponse.redirect(`${origin}/?error=auth_failed`)

  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) return NextResponse.redirect(`${origin}/?error=auth_failed`)

  return NextResponse.redirect(`${origin}${next}`)
}
```

### Querying with RLS as the boundary

```typescript
// src/server/data/messages.ts
import 'server-only'

import { createServerSupabaseClient } from '@/server/supabase'
import { SEARCH_RESULT_LIMIT } from '@/lib/constants'

export async function searchMessages(query: string): Promise<SearchOutcome> {
  if (query.trim() === '') return { status: 'no_terms' }

  const supabase = await createServerSupabaseClient()

  // RLS restricts the scan to the caller's rows. No user_id filter needed —
  // and adding one must never be the only thing protecting the data.
  const { data, error } = await supabase
    .rpc('search_messages', { query, result_limit: SEARCH_RESULT_LIMIT })

  if (error) {
    console.error('[data/messages] search failed', error)
    throw new Error('Search failed')
  }

  const results = data ?? []
  if (results.length > 0) return { status: 'ok', results }

  // Zero rows has two causes that need different words on screen. A query of
  // only stopwords parses to an EMPTY tsquery and could never have matched;
  // `search_has_terms` is what tells them apart, and it is asked only here, on
  // the path that was already a dead end. (F26)
  const { data: hasTerms } = await supabase.rpc('search_has_terms', { query })

  return hasTerms ? { status: 'ok', results } : { status: 'no_terms' }
}
```

Ranked search with snippets needs `ts_rank` and `ts_headline`, which
PostgREST cannot express — so it lives in a `security invoker` Postgres
function, which keeps RLS applied to the caller:

```sql
create or replace function search_messages(query text, result_limit int default 30)
returns table (
  message_id uuid,
  conversation_id uuid,
  conversation_title text,
  role message_role,
  snippet text,
  rank real,
  created_at timestamptz
)
language sql
stable
security invoker          -- runs as the caller, so RLS still applies
set search_path = public
as $$
  select
    m.id,
    m.conversation_id,
    c.title,
    m.role,
    -- NOT StartSel=<mark>. See the warning below this block. (F26)
    ts_headline('english', m.content, websearch_to_tsquery('english', query),
                'StartSel=' || chr(2) || ', StopSel=' || chr(3) || ', MaxFragments=2'),
    ts_rank(m.search_vector, websearch_to_tsquery('english', query)),
    m.created_at
  from messages m
  join conversations c on c.id = m.conversation_id
  where m.search_vector @@ websearch_to_tsquery('english', query)
  order by ts_rank(m.search_vector, websearch_to_tsquery('english', query)) desc,
           m.created_at desc, m.id desc     -- total, or the order is unstable
  limit result_limit;
$$;
```

**`ts_headline` does not escape the document it summarises, so the snippet must
never be treated as HTML.** This was measured against the project's own database
before feature 26 was written, and it is not what the option names suggest:

```
ts_headline over 'An <img src=x onerror=alert(2)> tag ... searchable ...'
  -> 'onerror=alert(2)> tag sits inside <mark>searchable</mark> content'
```

Two problems in one line. The `img` tag came through intact — and message
content is model output and user input, so a snippet rendered with
`dangerouslySetInnerHTML` would execute whatever somebody put in a message. And
fragment selection cut the tag in half, so even a sanitiser would be handed
markup that was never well formed.

So the delimiters here are `chr(2)` and `chr(3)` — STX and ETX, which cannot
occur in prose, mean nothing to a browser, and survive JSON encoding as
`\u0002` / `\u0003`. The snippet is plain text by construction and feature 27
splits on them to emit real React elements. That turns "only `<mark>` is
permitted, never arbitrary HTML" from a rule someone has to remember into a fact
about the data. The two values are named in `src/lib/constants.ts` as
`SEARCH_MATCH_START` / `SEARCH_MATCH_END`.

### Atomic quota reservation

This is the single most concurrency-sensitive statement in the project. It
**claims** a slot rather than checking one, so two simultaneous requests at the
daily boundary cannot both succeed.

```sql
-- Called from src/server/quota.ts BEFORE the provider request.
-- Returns the new count on success, or NO ROW when the limit is already reached.
create or replace function reserve_shared_slot(p_user_id uuid, p_limit int)
returns integer
language sql
security invoker
set search_path = public
as $$
  insert into shared_key_usage (user_id, usage_date, message_count, updated_at)
  values (p_user_id, (now() at time zone 'utc')::date, 1, now())
  on conflict (user_id, usage_date) do update
    set message_count = shared_key_usage.message_count + 1,
        -- LOAD-BEARING. The reconciliation sweep treats a row untouched for
        -- 5 minutes as holding an orphaned reservation. Without this the
        -- column keeps its INSERT-time value forever and the sweep starts
        -- releasing live reservations.
        updated_at    = now()
    -- THE RACE GUARD. Postgres serialises concurrent updates on this row;
    -- the loser matches no row and the function returns nothing.
    where shared_key_usage.message_count < p_limit
  returning message_count;
$$;
```

```sql
-- Refund when the generation fails or the user aborts. Floored at zero so a
-- double-release can never drive the counter negative.
create or replace function release_shared_slot(p_user_id uuid)
returns void
language sql
security invoker
set search_path = public
as $$
  update shared_key_usage
     set message_count = greatest(message_count - 1, 0),
         updated_at    = now()          -- keeps the staleness guard honest
   where user_id = p_user_id
     and usage_date = (now() at time zone 'utc')::date;
$$;
```

```sql
-- Token reconciliation AFTER completion. Accounting only — never enforcement.
create or replace function record_shared_tokens(
  p_user_id uuid,
  p_input_tokens bigint,
  p_output_tokens bigint
)
returns void
language sql
security invoker
set search_path = public
as $$
  update shared_key_usage
     set input_tokens  = input_tokens + p_input_tokens,
         output_tokens = output_tokens + p_output_tokens,
         updated_at    = now()          -- keeps the staleness guard honest
   where user_id = p_user_id
     and usage_date = (now() at time zone 'utc')::date;
$$;
```

**Rules for this function specifically:**

- Never replace the `where` clause with a preceding `select`. A read followed by
  a write — even inside one transaction at the default `read committed`
  isolation — reopens the race this function exists to close.
- `reserve_shared_slot` returning zero rows is the *expected* refusal path, not
  an error. Map it to `QuotaExceededError` → `429`.
- The circuit breaker on `shared_key_budget` is checked **before** this call, via
  the service-role client. A tripped breaker must not consume a user's slot.
- Title generation calls `record_shared_tokens` but **never** `reserve_shared_slot`
  — it costs money, so it is accounted, but it is system overhead and does not
  spend a user's daily allowance.

**Rules:**

- `auth.getUser()` validates the JWT against the auth server and is the only acceptable basis for an authorisation decision. `auth.getSession()` reads cookie data that a client could have forged — never gate access on it.
- Never write `.eq('user_id', userId)` as the sole protection on a query. RLS is the boundary; the filter is at best redundant.
- The session refresh lives in **`src/proxy.ts`** — Next.js 16 renamed `middleware.ts` → `proxy.ts` and the export `middleware` → `proxy`. Every Supabase SSR example still says "middleware"; port the cookie callbacks, not the filename.
- That file's `await supabase.auth.getUser()` call is load-bearing. Removing it stops cookie rotation and Server Components start rendering signed-out.
- In a Server Component the cookie store is read-only, so `setAll` throws. Swallow that specific error — the pattern in `architecture.md` does this deliberately, with a comment.
- Regenerate `src/types/database.ts` after every migration — via the **Supabase MCP** `generate_typescript_types`, since this project has no local CLI stack (F02). Never hand-edit it.
- Every migration that creates a table also enables RLS and defines its policies. A table shipped without policies is invisible to the anon key and a security hole under the service key.
- `security definer` functions are forbidden unless a written reason exists in `constraints.md` → Database access — they run as the owner and silently bypass RLS.
- Storage paths always start with the owner's user id, because the storage policy matches on the first path segment.

### Scheduled jobs (`pg_cron`)

Two jobs run inside Postgres. Render Cron Jobs are not used: they are a paid
service type unavailable on the free tier, and both jobs are pure database work
with no reason to make an HTTP round trip to reach the data they operate on.

**A storage object cannot be deleted with SQL.** `storage.objects` is metadata;
deleting a row leaves the file in the bucket, permanently orphaned and
unreachable. Supabase is explicit that deletion must go through the Storage API.
This splits the two jobs across two mechanisms, matched to what each actually
needs:

| Job | Schedule | Mechanism | Why |
| --- | --- | --- | --- |
| Quota reconciliation | every 10 min | `pg_cron` → SQL function | Pure database work. Nothing to call out to. |
| Attachment reaping | hourly | `pg_cron` → `pg_net` → Edge Function | Must call the Storage API to delete files. SQL alone would orphan every object it "cleaned". |

```sql
-- supabase/migrations/<ts>_enable_scheduled_jobs.sql
create extension if not exists pg_cron;
create extension if not exists pg_net;   -- required to reach the Edge Function

-- Pure SQL: correct quota drift from reservations whose request died mid-flight.
select cron.schedule(
  'reconcile-shared-quota',
  '*/10 * * * *',
  $$ select reconcile_shared_key_usage() $$
);

-- Storage-aware: invoke the Edge Function, which deletes objects THEN rows.
select cron.schedule(
  'reap-orphaned-attachments',
  '0 * * * *',
  $$
  select net.http_post(
    url     := current_setting('app.settings.edge_url') || '/reap-attachments',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_key')
    )
  )
  $$
);
```

```typescript
// supabase/functions/reap-attachments/index.ts
// Order matters: storage first, row second. A crash between them leaves a row
// pointing at a deleted file, which the next run retries harmlessly. The
// reverse order leaks the file forever with no record that it existed.
const { data: orphans } = await supabase
  .from('attachments')
  .select('id, storage_path')
  .is('message_id', null)
  .lt('created_at', new Date(Date.now() - 24 * 3600_000).toISOString())
  .limit(1000)                        // Storage remove() caps at 1000 per call

if (!orphans?.length) return new Response('nothing to reap')

const { error: storageError } = await supabase
  .storage
  .from('attachments')
  .remove(orphans.map((o) => o.storage_path))

if (storageError) throw storageError  // do NOT delete rows if files survived

await supabase
  .from('attachments')
  .delete()
  .in('id', orphans.map((o) => o.id))
```

**Rules:**

- Both jobs are created by a migration, never through the dashboard, so a fresh environment gets them automatically.
- The reconciliation job may only *lower* `message_count`, and only on rows untouched for longer than `STREAM_TIMEOUT_MS`. Review that guard before touching the query — removing it makes the sweep race live requests.
- **Never delete a storage object with SQL.** `delete from storage.objects` removes the metadata and strands the file. Every object deletion goes through `storage.from(...).remove(...)`, which is why the reaper is an Edge Function rather than a SQL statement.
- The reaper deletes the object first and the row second. A crash in between leaves a row pointing at a missing file, which the next run cleans up. The reverse order leaks the file with no record it ever existed.
- `remove()` accepts at most 1,000 paths per call, so the reaper batches and simply runs again next hour if there is more.
- Inspect runs with `select * from cron.job_run_details order by start_time desc limit 20`. A silently failing pg_cron job is the main operational risk of choosing it over an HTTP cron, so check this table when quota numbers look wrong.

**Local development gotcha.** `create extension pg_cron` fails on a fresh local
stack with *"can only create extension in database postgres"*, because pg_cron
defaults to the `postgres` database while the Supabase CLI runs against another.
Set `cron.database_name` in the local Postgres config before `supabase start` —
it cannot be changed from inside a migration with `set_config()`, since the
parameter requires a server restart. If local scheduling proves more trouble than
it is worth, run the two job bodies manually in tests; they are ordinary SQL
functions and do not need the scheduler to be verified.

---

## Tailwind CSS v4 + shadcn/ui

**Check first:** Context7 → `/tailwindlabs/tailwindcss` for v4 syntax. Tailwind
v4 configures through CSS `@theme`, not `tailwind.config.js` — any snippet with
a `module.exports` config object is v3 and does not apply here.

### Setup

Tokens are declared once in `src/app/globals.css` (the full block is in
`architecture.md` → Key Patterns). Fonts load through `next/font`:

```tsx
// src/app/layout.tsx
import { Inter, DM_Mono, Instrument_Serif } from 'next/font/google'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })
const dmMono = DM_Mono({ subsets: ['latin'], weight: '400', variable: '--font-dm-mono' })
const instrumentSerif = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  style: 'italic',
  variable: '--font-instrument-serif',
})

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${dmMono.variable} ${instrumentSerif.variable}`}>
      <body className="bg-canvas text-ink font-sans antialiased">{children}</body>
    </html>
  )
}
```

### Restyling a shadcn component

Every generated component is retuned to the PromptX tokens before use. A
component left with its default palette or `0.5rem` radius is a defect.

```tsx
// src/components/ui/button.tsx — variants after restyling
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-xs whitespace-nowrap rounded-sm ' +
    'text-sm font-medium transition-colors ' +
    'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary focus-visible:ring-offset-2 ' +
    'focus-visible:ring-offset-canvas disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        // Off-white fill on warm dark — the only "primary colour" in the system.
        primary: 'bg-primary text-on-primary hover:bg-body-strong',
        ghost: 'bg-transparent text-ink hover:bg-canvas-soft',
        outline: 'border border-hairline bg-transparent text-ink hover:bg-canvas-soft',
        // State-only. Never for a normal call to action.
        danger: 'bg-transparent text-danger hover:bg-danger/10',
      },
      size: {
        sm: 'h-8 px-md',
        md: 'h-9 px-lg',
        icon: 'size-9 rounded-pill',
      },
    },
    defaultVariants: { variant: 'ghost', size: 'md' },
  },
)
```

**Rules:**

- No `tailwind.config.js`. All configuration is `@theme` in `globals.css`.
- Use semantic token classes: `bg-canvas-soft`, `text-mute`, `border-hairline`, `rounded-sm`, `p-xl`. Never `bg-zinc-900`, never `text-[#f7f5f0]`, never `p-[13px]`.
- Dark-only. Do not write a `dark:` variant anywhere — there is no light theme to vary from.
- Elevation is `border border-hairline` on `bg-canvas-soft`. No `shadow-*` on cards, panels, or the sidebar. Modals and toasts are the only exceptions.
- Compose classes with `cn()` from `src/lib/utils.ts` so conditional classes merge correctly.
- When `npx shadcn@latest add <component>` generates a file, immediately replace its colour, radius, and focus-ring classes with tokens before committing it.
- Every interactive element keeps a visible focus ring: `ring-1 ring-primary ring-offset-2 ring-offset-canvas`.

---

## react-markdown + shiki

**Check first:** Context7 → `/remarkjs/react-markdown` and `/shikijs/shiki`.

### Rendering an assistant message

Fenced code is intercepted at `pre`, not at `code`. This is the part every
example online gets wrong, including the one that used to be in this file:
branching on `className` inside `code` only sees a fence that named its
language. A bare ```` ``` ```` fence arrives with no class at all, falls to the
inline branch, and renders as inline code in the middle of a paragraph. Reading
the hast node instead catches both, and replacing `pre` avoids nesting the code
block's `<div>` inside a `<pre>` — which is invalid HTML and warns in React.

```tsx
// src/components/chat/MarkdownMessage.tsx
<Markdown
  remarkPlugins={[remarkGfm]}
  components={{
    pre({ node, children }) {
      const fence = readFence(node) // pulls text + `language-x` off the <code> child
      if (!fence) return <>{children}</>

      return <CodeBlock code={fence.code} language={fence.language} isStreaming={isStreaming} />
    },
    // Only inline code reaches this now — `pre` above never renders its children
    // for a fence, so no branch is needed here.
    code({ children, ...props }) {
      return <code {...props} className="rounded-xs bg-canvas-soft px-xs py-xxs font-mono text-code text-ink">{children}</code>
    },
    a({ children, ...props }) {
      return (
        <a {...props} target="_blank" rel="noopener noreferrer"
           className="text-ink underline underline-offset-2 hover:text-body-strong">
          {children}
        </a>
      )
    },
  }}
>
  {content}
</Markdown>
```

Everything else markdown produces — headings, lists, tables, blockquotes — is
styled by `.markdown-body` in `globals.css` rather than by a `components` entry.
Only these three carry behaviour, and writing the other fifteen as near-identical
Tailwind strings buries them.

### Highlighting runs in the browser here, not on the server

This contradicts the usual advice, and the reason is structural rather than a
preference. The thread lives inside `Chat`, a Client Component holding `useChat`
state. A streaming message does not exist on the server at render time, and
after `router.refresh()` even persisted messages re-render from client state —
so a server-rendered highlight would apply to nothing that stays on screen.

What follows from that:

```ts
// src/lib/highlighter.ts
const highlighter = await createHighlighterCore({
  themes: [promptxTheme],
  langs: [],
  engine: createJavaScriptRegexEngine(), // not Oniguruma: ~1 MB of WASM avoided
})

await highlighter.loadLanguage(bundledLanguages[language]) // one grammar, on first use
highlighter.codeToHtml(code, { lang: language, theme: PROMPTX_THEME_NAME, structure: 'inline' })
```

- `shiki/core`, `shiki/engine/javascript`, `shiki/langs` and every grammar are **dynamically imported**. A conversation with no code fence downloads none of them.
- `shiki/langs` is a map of importers, not of grammars — reading it costs an index module, and only the entry called downloads anything. This is why `@shikijs/langs` never becomes a direct dependency.
- `structure: 'inline'` returns token spans only. The default emits shiki's own `<pre>` with its own padding and background, which would paint a second rectangle inside DESIGN.md's `code-block`.
- The output goes through `dangerouslySetInnerHTML`, which is acceptable for exactly one reason: shiki HTML-escapes every token's text, so the only markup in the string is spans shiki generated. That is pinned by a test, not assumed.

**Rules:**

- Never enable `rehype-raw` or otherwise allow raw HTML. Model output is untrusted input and this is the XSS vector that matters most here.
- One highlighter instance per process, held as a module-level promise so concurrent callers join it rather than each building their own.
- The code block component owns the copy button and the language label. Do not duplicate that markup per call site.
- The allowlist (`typescript`, `tsx`, `javascript`, `jsx`, `python`, `sql`, `shellscript`, `json`, `go`, `rust`, `css`, `html`) is a **compatibility** guarantee, not a size one — lazy loading already handles size. The JavaScript RegExp engine cannot emulate every Oniguruma pattern, and shiki's `forgiving` flag would swallow exactly that failure. Extending the list means extending `tests/lib/highlighter.test.ts`, which loads each grammar for real.
- Use shiki's **canonical** ids. `bash`, `sh`, `shell` and `zsh` are all aliases of `shellscript`; treating `bash` as canonical works by accident and breaks the alias table.
- Anything outside the allowlist renders plain, keeping the fence's own label. Unhighlighted code is still code.
- The shiki theme must be retuned to the `DESIGN.md` palette — a stock theme like `github-dark` reintroduces chromatic accents the brand does not use. With no brand hue and the state colours reserved, lightness and italics are the only axes available.
- Highlighting waits until a message settles. Re-tokenising a growing string is quadratic over a stream, and a half-written fence tokenises as whatever it currently looks like — an unclosed string swallows the rest of the block and then unswallows it.
- Streaming markdown is frequently mid-token and syntactically incomplete. Wrap the renderer in a **per-message** error boundary — `error.tsx` at the route group would blank the whole workspace. The boundary must reset when the content changes, or one bad fragment kills the message permanently even though the next delta parses cleanly.
- All links open in a new tab with `rel="noopener noreferrer"`.

---

## zod v4

**Check first:** Context7 → `/colinhacks/zod`. Note that v4 promoted string
formats to top-level functions: `z.uuid()`, `z.email()`, and `z.url()` replace
the deprecated `z.string().uuid()` chain form. Snippets using the chain are v3.

### Validating a route input

```typescript
// src/lib/schemas.ts
import { z } from 'zod'

export const providerSchema = z.enum(['openai', 'anthropic', 'google', 'openrouter'])

// Singular `message` — the client sends only the newest turn. The system prompt
// is read from the conversation row server-side, never accepted from the client.
export const chatRequestSchema = z.object({
  // Nullable: null means "no conversation yet, create one". Creation lives
  // inside /api/chat rather than a separate endpoint so that a refusal — a
  // quota wall at F16, a tripped breaker at F17 — leaves no empty "New chat"
  // behind. See src/lib/schemas.ts, which is the live copy. (F07)
  conversationId: z.uuid().nullable(),
  message: z.object({
    id: z.string(),
    role: z.literal('user'),
    parts: z.array(z.object({ type: z.literal('text'), text: z.string().min(1).max(100_000) })),
  }),
  provider: providerSchema,
  modelId: z.string().min(1).max(120),
})

export type ChatRequest = z.infer<typeof chatRequestSchema>

export const createKeySchema = z.object({
  provider: providerSchema,
  apiKey: z.string().min(20).max(300),
  label: z.string().max(60).optional(),
})
```

### Validating the environment at boot

```typescript
// src/server/env.ts — SERVER ONLY. Secrets read here and nowhere else.
import 'server-only'

import { z } from 'zod'

const serverEnvSchema = z.object({
  SUPABASE_SECRET_KEY: z.string().min(1),
  ENCRYPTION_KEY: z
    .string()
    .refine((value) => Buffer.from(value, 'base64').length === 32, {
      message: 'ENCRYPTION_KEY must be 32 bytes, base64-encoded',
    }),
  SHARED_GEMINI_API_KEY: z.string().min(1),
})

/** Throws at startup, not at the first request that needs a variable. */
export const serverEnv = serverEnvSchema.parse(process.env)
```

**Rules:**

- Every route handler parses its body with `safeParse` and returns `400` on failure. Never `JSON.parse` a body and use it directly.
- Never include the zod error detail in a client response — it echoes the submitted values back, which for `/api/keys` would mean reflecting an API key. Return `{ error: 'Invalid request', code: 'invalid_input' }` and log the detail server-side.
- Derive TypeScript types from schemas with `z.infer` rather than declaring both and letting them drift.
- Schemas shared between client and server live in `src/lib/schemas.ts`. Secret validation lives in `src/server/env.ts`, which carries `import 'server-only'` and can never be imported by a Client Component.
- Use the v4 top-level format helpers (`z.uuid()`, not `z.string().uuid()`).
- Cap every string field with `.max()`. An unbounded `z.string()` on a chat message is a denial-of-service vector.

---

## node:crypto

**Check first:** the Node.js documentation for `crypto.createCipheriv`. This is
the most security-sensitive module in the project — do not improvise it. The
canonical implementation is in `architecture.md` → Key Patterns and must be
copied exactly.

**Rules:**

- AES-256-GCM only. Not CBC (no integrity), not ECB, not a hand-rolled scheme.
- A fresh 12-byte random IV per encryption, from `randomBytes`. Reusing an IV with GCM is a catastrophic failure that leaks the key stream — never derive an IV from the user id, the provider, or a counter.
- Always store and verify the 16-byte auth tag. Decryption without `setAuthTag` silently accepts tampered ciphertext.
- `ENCRYPTION_KEY` is read only inside `src/server/env.ts`, which validates its length at boot; `src/server/vault.ts` consumes it through `serverEnv` and deliberately does not re-check it. Two modules validating one variable is two rules to keep in step. (F12)
- Ciphertext, IV, and auth tag are stored as `bytea`, not as base64 text — but note the round trip this was meant to avoid is **not** actually avoidable here. PostgREST has no binary representation in JSON and renders `bytea` as a `\x`-prefixed hex string, which is why `src/types/database.ts` types all three columns as `string`. Handing supabase-js a `Buffer` does not fail loudly: it serialises to `{"type":"Buffer","data":[…]}`, Postgres accepts those bytes, the write reports success, and the damage surfaces later as a decryption failure against a real user's key — measured at F12/F13 by mutating the conversion and watching the round-trip test fail on stored content that decoded to `{"type":"Buffer"…`. The conversion therefore lives in exactly one place, `src/server/data/provider-keys.ts`, and is proven by a test that writes and reads back through the real database. (F13)
- Any route that reaches this module declares `export const runtime = 'nodejs'`. `node:crypto` does not exist on the Edge runtime.
- The vault has no logging. Do not add a `console.log` to it, even temporarily during debugging.

---

## OpenRouter (`@openrouter/ai-sdk-provider`)

**Check first:** Context7 → `/openrouterteam/ai-sdk-provider`.

### Setup

```typescript
import { createOpenRouter } from '@openrouter/ai-sdk-provider'

// Called only from resolveModel(), with a per-request decrypted key.
const model = createOpenRouter({ apiKey })('anthropic/claude-opus-5')
```

**Rules:**

- OpenRouter model ids are namespaced (`openai/gpt-5`, `google/gemini-2.5-flash`). Validate that a submitted id contains a `/` before use, so an OpenRouter id cannot be sent to a native provider or vice versa.
- The v1 model catalog is a fixed curated list in `src/lib/models.ts`. Do not fetch OpenRouter's live `/models` endpoint — a dynamic catalog is explicitly out of scope for v1.
- OpenRouter is never the shared-key fallback. Only Google is, and only with `SHARED_MODEL_ID`.
- Set `appName: 'PromptX'` and `appUrl` from `NEXT_PUBLIC_SITE_URL` so requests are attributable in the user's OpenRouter dashboard.
- Provider-specific options go in `providerOptions.openrouter`, not in the top-level `streamText` arguments.

---

## Vitest (`vitest@^4`)

**Check first:** Context7 → `/vitest-dev/vitest`. The subjects this suite must
cover are fixed in `code-standards.md` → Testing; this section is only about how
to write them.

### Setup

The `@/` alias is declared with `resolve.alias` rather than the
`vite-tsconfig-paths` plugin — three lines beat a dependency, per the
Dependencies gate in `code-standards.md`.

```typescript
// vitest.config.ts
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // Required. See "The server-only gotcha" below.
      'server-only': fileURLToPath(
        new URL('./tests/stubs/server-only.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'node',
    // Tests live in tests/, mirroring src/server/ — see architecture.md's
    // folder structure and the naming rule in code-standards.md.
    include: ['tests/**/*.test.ts'],
    restoreMocks: true,
    unstubEnvs: true,
  },
})
```

`environment: 'node'` is not optional — the vault needs real `node:crypto`, and
`jsdom` would shim it. `restoreMocks` and `unstubEnvs` reset spies and stubbed
env vars after every test so a leaked `ENCRYPTION_KEY` cannot make the next test
pass for the wrong reason.

**The `server-only` gotcha.** Every module under `src/server/` begins with
`import 'server-only'`, and that package resolves to a module which *throws*
unless the bundler sets the `react-server` export condition. Vitest sets no such
condition, so without the alias above the entire server suite fails at import
time — before a single assertion runs, and for a reason that has nothing to do
with what is being tested. The stub at `tests/stubs/server-only.ts` is an empty
module and must stay that way; the real guard still does its job at build time,
which is where it matters.

### Testing the vault

The vault reads its master key through `src/server/env.ts`, which parses the
secret environment **once at module load**. `vi.stubEnv` alone therefore cannot
reach it — by the time a test body runs, `serverEnv` is already frozen at
whatever the environment held on first import. Reset the registry and import
fresh, the same way `tests/server/env.test.ts` does:

```typescript
// tests/server/vault.test.ts
const KEY_32 = Buffer.alloc(32, 7).toString('base64')

// env.ts validates the WHOLE secret environment, so all three are stubbed.
const VALID_ENV = {
  SUPABASE_SECRET_KEY: 'sb_secret_test_value',
  ENCRYPTION_KEY: KEY_32,
  SHARED_GEMINI_API_KEY: 'test-gemini-key',
}

function loadVault(overrides: Partial<typeof VALID_ENV> = {}) {
  for (const [key, value] of Object.entries({ ...VALID_ENV, ...overrides })) {
    vi.stubEnv(key, value)
  }
  return import('@/server/vault')
}

beforeEach(() => {
  vi.resetModules()
})

it('refuses ciphertext that has been modified', async () => {
  // The module — not just the functions. Each import produces a NEW
  // DecryptionError class, so `instanceof` only holds against the one from
  // this same call.
  const { encrypt, decrypt, DecryptionError } = await loadVault()

  const sealed = encrypt('sk-test-abcdef1234')
  // Via the Buffer API: noUncheckedIndexedAccess types `sealed.ciphertext[0]`
  // as `number | undefined`, and `^=` does not narrow it.
  sealed.ciphertext.writeUInt8(sealed.ciphertext.readUInt8(0) ^ 0xff, 0)

  expect(() => decrypt(sealed)).toThrow(DecryptionError)
})
```

**Rules for this suite specifically:**

- Stub a fixed key rather than using the real `ENCRYPTION_KEY` that `vitest.config.ts` loads from `.env.local`. The suite must give the same answer on a machine that has never held a real key.
- **Corrupt all three fields independently** — ciphertext, IV, and auth tag. One is not a proxy for the others.
- **The tamper tests do not prove integrity on their own.** Measured at F12: deleting `setAuthTag` entirely leaves all three green, because node refuses `final()` on a GCM decipher that was never given a tag, so they still throw — for an unrelated reason. The **round-trip** tests are what fail on that mutation. Keep both halves.
- Assert the failure carries no payload: no plaintext, no key, and no `cause`. Capture the error in a variable rather than asserting inside a `catch` — an `expect()` that throws from inside its own `try` is caught by that same `catch` and then asserted against, which is how a draft of this test passed against a `decrypt()` that never threw at all.
- The wrong-length-key case asserts that **importing** the vault rejects, not that `encrypt()` throws. The rule lives in `env.ts` now; this proves the vault inherits it.

### Mocking the provider boundary

Provider clients are mocked at `resolveModel()` and nowhere deeper — mocking the
SDK itself would let a broken resolution path still pass.

```typescript
import { vi } from 'vitest'

import type { ResolvedModel } from '@/server/providers'

vi.mock('@/server/providers', () => ({
  resolveModel: vi.fn(
    async (): Promise<ResolvedModel> => ({
      model: {} as never,
      usedSharedKey: true,
    }),
  ),
}))
```

Match `ResolvedModel` exactly — it is `{ model, usedSharedKey }` and nothing
more. A mock that returns extra fields will keep passing after the real shape
changes.

### The quota concurrency test

The invariant that the daily slot is *claimed, never checked* is only provable
under real concurrency. Fire the requests together against a local Supabase
instance and count the winners — do not await them in sequence. `reserveSharedSlot`
signals refusal by throwing, so settle rather than reject the batch:

```typescript
import { SHARED_KEY_DAILY_MESSAGE_LIMIT } from '@/lib/constants'
import { reserveSharedSlot } from '@/server/quota'

it('issues no more than the daily allowance under concurrent load', async () => {
  const results = await Promise.allSettled(
    Array.from({ length: SHARED_KEY_DAILY_MESSAGE_LIMIT * 2 }, () =>
      reserveSharedSlot(userId),
    ),
  )

  const granted = results.filter((r) => r.status === 'fulfilled')
  expect(granted).toHaveLength(SHARED_KEY_DAILY_MESSAGE_LIMIT)
})
```

**Rules:**

- `environment: 'node'`. This suite tests `src/server/`; it does not render components.
- Never mock `node:crypto`. The vault's whole value is that the real primitive behaves correctly — a mocked cipher tests nothing.
- Stub secrets with `vi.stubEnv`, never by assigning to `process.env` directly, so `unstubEnvs` can restore them.
- Mock provider access at `resolveModel()` only. No test may reach a paid provider API.
- `data/` and quota tests run against the **hosted** Supabase project, not against mocks — an RLS policy cannot be verified against a fake client. There is no local stack and no `seed.sql` (F02, F03), so each suite creates its own fixtures and tears them down. Sessions come from `auth.admin.createUser()` on the service-role client followed by `signInWithPassword`; assertions then run through a publishable-key client carrying that JWT, which is what puts grants, policies and PostgREST all in the path. Seed fixtures with the service-role client so a broken write policy cannot leave a table empty and make an isolation assertion pass for the wrong reason. See `tests/rls/isolation.test.ts`.
- Sequential `await`s do not prove a race is closed. Any test defending a concurrency invariant uses `Promise.all`.
- Name tests by behaviour (`it('refuses the 21st shared-key message of the day')`), never by the function called.

---

## Playwright

**Check first:** Context7 → `/microsoft/playwright`.

**For interactive debugging, use the `playwright-cli` skill.** The Playwright MCP
server this section used to point at has been removed and replaced by it. The
distinction that matters: the CLI drives a browser *now* to confirm something
renders; `@playwright/test` and the `e2e/` suite below are the committed suite,
which arrived at **feature 36**.

`pnpm test:e2e` runs against a **production build** — `pnpm build && pnpm start`,
the same command Render runs — because `NEXT_PUBLIC_*` are inlined at build time
and the dev server has already disagreed with production about response headers
once. It **fails rather than skips** on a checkout with no credentials or no
browser binary, unlike `pnpm test`: every spec here is hosted, so a skipping run
would execute nothing and still report success.

Because sign-in is Google OAuth only, an unauthenticated browser is redirected
to `/` before it ever reaches the app. Open with `--persistent --profile`
against a profile that is already signed in, or `state-load` a session saved
earlier — the same problem the `storageState` rule below solves for the specs.

**Rules:**

- Four **flow** specs, matching `code-standards.md` → Testing, plus the audit suite F37 added: `accessibility`, `keyboard`, `responsive`, `live-region` and `performance`. Do not grow the E2E suite to cover what a unit test can prove — the audit specs earn their place precisely because no unit test here can see a rendered tree.
- **`toBeVisible()` ignores opacity.** It checks display, visibility and a non-empty box, so a fully transparent control passes. For anything revealed by `hover:`/`pointer-coarse:`, compute the effective opacity up the ancestor chain — the reveal class usually sits on a wrapper, so even `toHaveCSS('opacity', '1')` on the control itself passes regardless. Both weaker forms were measured passing with the reveal rule deleted. (F37)
- **Read a transitioning value with `expect.poll`, never once.** Anything with `transition-colors` returns its pre-transition value in the same tick as the interaction — the F07 trap, met again at F37 on the composer's focus border.
- **The sidebar exists twice in the DOM**, so `.first()` can resolve to the hidden copy. Use `.locator('visible=true')`. And a control resting at `opacity: 0` behind a full-row `after:inset-0` overlay needs a real `hover()` before it will take a click, exactly as a mouse user would. (F11, met again F37)
- Tests run against the hosted Supabase development project, never against production or a live provider API. There is no local instance; specs create and tear down their own fixtures, reusing the pattern in `tests/rls/isolation.test.ts`.
- Google OAuth is not driven through a real consent screen. Seed a test user and inject the session cookie via `storageState`.
- **Provider calls cannot be intercepted with `page.route()`, and this line used to say they were.** `page.route()` sees *browser* requests, and the browser never contacts a provider here — `streamText` runs inside `/api/chat` and `probeKey` inside `/api/keys`, both server-side. What the specs intercept is the application's **own** routes, answered with canned responses. No test spends real money, which was always the real requirement. (F36)
- **A canned stream needs a real server, not `route.fulfill()`.** Fulfil sends the whole body at once, so the client receives a single chunk and no assertion can tell an incremental render from a blob — a streaming test that would pass identically without streaming. `e2e/support/mock-chat.ts` runs a tiny SSE server on an ephemeral port and the route is redirected to it with `route.continue({ url })`; the frame shape (`text-start` / `text-delta` / `text-end`, then `data: [DONE]`, with `x-vercel-ai-ui-message-stream: v1`) is read off the installed `ai` package. (F36)
- **Every interception asserts it actually fired.** A route that never matches is a spec quietly reaching the real endpoint — which on the chat path spends a shared-key slot and real money, while still going green. (F36)
- **An intercepted mutation must also perform the write it is pretending to do.** A successful mutation calls `router.refresh()`, which re-renders the Server Component from the database, so a handler that returns `201` and stores nothing produces a page correctly reporting that nothing was stored. (F36)
- Select by role and accessible name (`getByRole('button', { name: 'Send' })`), never by CSS class — class names are design tokens here and will change.
- Assert on the quota wall's text content, since that message is a stated success criterion in `project-overview.md`.

---
