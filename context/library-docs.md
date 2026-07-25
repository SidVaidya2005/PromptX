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
2. **Check if an MCP server is configured** for that library — if available, use it before falling back to general knowledge.
3. **Read this file** for project-specific patterns that override general library knowledge.

The order of authority is:

```
MCP server (real-time docs) → Skills via CLAUDE.md → This file (project rules) → General training knowledge
```

Never rely on general training knowledge alone for library APIs — they change
frequently and training data may be outdated.

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
createGoogle({ apiKey })('gemini-2.5-flash')
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

export async function searchMessages(query: string) {
  const supabase = await createServerSupabaseClient()

  // RLS restricts the scan to the caller's rows. No user_id filter needed —
  // and adding one must never be the only thing protecting the data.
  const { data, error } = await supabase
    .rpc('search_messages', { query, result_limit: SEARCH_RESULT_LIMIT })

  if (error) {
    console.error('[data/messages] search failed', error)
    throw new Error('Search failed')
  }

  return data ?? []
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
    ts_headline('english', m.content, websearch_to_tsquery('english', query),
                'StartSel=<mark>, StopSel=</mark>, MaxFragments=2'),
    ts_rank(m.search_vector, websearch_to_tsquery('english', query)),
    m.created_at
  from messages m
  join conversations c on c.id = m.conversation_id
  where m.search_vector @@ websearch_to_tsquery('english', query)
  order by ts_rank(m.search_vector, websearch_to_tsquery('english', query)) desc
  limit result_limit;
$$;
```

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
- Regenerate `src/types/database.ts` after every migration (`supabase gen types typescript --local`). Never hand-edit it.
- Every migration that creates a table also enables RLS and defines its policies. A table shipped without policies is invisible to the anon key and a security hole under the service key.
- `security definer` functions are forbidden unless a written reason exists in `build-journal.md` — they run as the owner and silently bypass RLS.
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

```tsx
// src/components/chat/markdown-message.tsx
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export function MarkdownMessage({ content }: { content: string }) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      components={{
        code({ className, children, ...props }) {
          const language = /language-(\w+)/.exec(className ?? '')?.[1]

          return language ? (
            <CodeBlock language={language} code={String(children).trimEnd()} />
          ) : (
            <code className="rounded-xs bg-canvas-soft px-xs py-xxs font-mono text-[13px]" {...props}>
              {children}
            </code>
          )
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
  )
}
```

**Rules:**

- Never enable `rehype-raw` or otherwise allow raw HTML. Model output is untrusted input and this is the XSS vector that matters most here.
- Shiki highlighting runs on the server where possible. A shiki highlighter instance is expensive — create it once per process, never per message.
- The code block component owns the copy button and the language label. Do not duplicate that markup per call site.
- Only load the language grammars actually used (`ts`, `tsx`, `js`, `python`, `sql`, `bash`, `json`, `go`, `rust`, `css`, `html`), with a plaintext fallback for anything else. Loading every grammar adds megabytes.
- The shiki theme must be retuned to the `DESIGN.md` palette — a stock theme like `github-dark` reintroduces chromatic accents the brand does not use.
- Streaming markdown is frequently mid-token and syntactically incomplete. The renderer must tolerate an unclosed fence or bracket without throwing; wrap it in an error boundary.
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
  conversationId: z.uuid(),
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
- `ENCRYPTION_KEY` is read only inside `src/server/vault.ts`, and its length is validated before use.
- Ciphertext, IV, and auth tag are stored as `bytea`, not as base64 text. No re-encoding round-trip to get wrong.
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

## Playwright

**Check first:** Context7 → `/microsoft/playwright`. A Playwright MCP server is
also available for interactive debugging of a running app.

**Rules:**

- Four specs only, matching `code-standards.md` → Testing. Do not grow the E2E suite to cover what a unit test can prove.
- Tests run against a local Supabase instance (`supabase start`) with `supabase/seed.sql`, never against production or a live provider API.
- Google OAuth is not driven through a real consent screen. Seed a test user and inject the session cookie via `storageState`.
- Provider calls are intercepted with `page.route()` and answered with a canned stream. No test spends real money.
- Select by role and accessible name (`getByRole('button', { name: 'Send' })`), never by CSS class — class names are design tokens here and will change.
- Assert on the quota wall's text content, since that message is a stated success criterion in `project-overview.md`.

---
