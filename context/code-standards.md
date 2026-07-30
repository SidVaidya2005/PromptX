# Code Standards

> **Role:** The rules every change must follow — language, framework, naming, error handling, dependencies.
> **Read before writing code**; obey on every change.
> **Relates to:** derives from the stack in `architecture.md`.

Implementation rules and conventions for the entire project. The AI agent must
follow these in every session without exception. These rules prevent pattern
drift across sessions.

---

## Engineering Mindset

The AI agent on this project operates as a senior engineer. This means:

- **Think before implementing** — understand what is being built and why before writing a single line
- **Read context files first** — never assume, always verify against `architecture.md` and `project-overview.md`
- **Scope is sacred** — only build what the current feature requires; never go beyond scope even if it seems helpful
- **Every feature must be testable** — if it cannot be verified immediately after implementation, it is incomplete
- **Clean over clever** — simple readable code a junior can follow beats clever abstractions
- **One thing at a time** — complete one feature fully before touching the next
- **Failures are expected** — handle errors deliberately; never let one failure crash everything
- **Secrets deserve paranoia** — this codebase holds other people's API keys. When a change touches `src/server/vault.ts`, `src/server/keys.ts`, or anything that reads them, slow down and check the invariants in `architecture.md` explicitly.

---

## TypeScript

- `strict: true` in `tsconfig.json`, plus `noUncheckedIndexedAccess` and `noImplicitOverride`. These are not negotiable.
- `any` is forbidden. Use `unknown` at boundaries and narrow it. If a third-party type is genuinely wrong, write a local type and cast once at the seam with a comment explaining why.
- No non-null assertions (`!`) on values derived from user input, database reads, or `fetch` responses. They are permitted only on environment variables already validated at startup by `src/server/env.ts`.
- Prefer `type` over `interface`. Use `interface` only when declaration merging is genuinely needed.
- Model absent values as `null` for anything that round-trips through Postgres, and `undefined` only for optional function arguments and unset object properties.
- Prefer discriminated unions over optional-field soup. A message that may be streaming, complete, or errored is a union on `status`, not four independent optional fields.
- `const` by default; `let` only when reassignment is real. `var` never.
- Never mutate a function parameter. Build a new object or array.
- All async work uses `async`/`await`. No raw `.then()` chains. A promise that is deliberately not awaited is prefixed `void` with a comment saying why.
- Exported functions declare their return type explicitly. Local helpers may infer.
- Enums from the database are typed from `src/types/database.ts`. Never redeclare a union of string literals that duplicates a Postgres enum.

---

## Next.js 16 Conventions

- App Router only. There is no `pages/` directory and none may be created.
- **Server Components are the default.** `'use client'` is added only when a component needs state, an effect, a browser API, or an event handler — and it is pushed as far down the tree as possible. A page is a Server Component that fetches data and passes it to small client leaves.
- Data fetching for a page happens in the Server Component. Client Components receive data as props. Do not fetch in a `useEffect` what the server could have rendered.
- Route handlers (`route.ts`) are for streaming, mutations called from client code, and anything needing a non-GET verb. They always call `getUser()` or `requireUser()` first.
- Every route handler that touches the vault declares `export const runtime = 'nodejs'`. On Render every route is Node already, so this documents intent rather than guarding against anything — but it stays, so the requirement survives a future move to a host that does offer Edge.
- **Do not add `export const maxDuration`.** It is a Vercel directive and does nothing on Render, where the platform ceiling is 100 minutes. Writing it implies a protection that is not there. Streaming routes are bounded by `STREAM_TIMEOUT_MS` in application code instead.
- Every provider call passes an `AbortSignal` derived from `STREAM_TIMEOUT_MS`. Render will happily hold a request open for an hour and a half; a hung upstream connection must be cut by us, or it pins a quota reservation and a slot in the single instance.
- `params` and `searchParams` are Promises — always `await` them. Next.js 16 removed the synchronous fallback that 15 still allowed, so a missing `await` now breaks at runtime while compiling cleanly.
- `cookies()`, `headers()`, and `draftMode()` are async — always `await` them.
- **The session-refresh file is `src/proxy.ts`, not `middleware.ts`.** Next.js 16 renamed both the file and its export (`export function proxy`). Its runtime is `nodejs` and cannot be configured. Every Supabase SSR example online still says "middleware" — port the cookie logic, not the filename.
- Server Actions are not used in this project. Mutations go through route handlers, so that the same validation and error contract covers every write path.
- Revalidate after a mutation with `revalidatePath()` from the route handler; do not rely on client-side cache invalidation alone. If `revalidateTag()` is ever needed it now requires a second `cacheLife` argument — the single-argument form is a type error.
- Turbopack is the default for `next dev` and `next build`. Do not add `--turbopack` flags, and do not introduce a webpack config — one present at build time fails the build.
- `next lint` no longer exists. Linting runs through the ESLint CLI with flat config (`eslint.config.mjs`), and `next build` does not lint.
- Every parallel route slot requires an explicit `default.tsx`, or the build fails.
- Dynamic routes that read user data set `export const dynamic = 'force-dynamic'`, or use `await cookies()` which opts them out of static rendering implicitly.
- `loading.tsx` and `error.tsx` are provided for `/chat/[id]`, `/search`, and `/prompts`. A route that can be slow gets a skeleton, not a blank frame.

---

## File and Folder Naming

- Folders: `kebab-case` (`src/components/chat`, `src/server/data`).
- React components: `PascalCase.tsx`, one component per file, named the same as the file (`MessageBubble.tsx` exports `MessageBubble`).
- Non-component TypeScript: `kebab-case.ts` (`shared-key-usage.ts`, `model-catalog.ts`).
- Next.js special files keep their framework names exactly: `page.tsx`, `layout.tsx`, `route.ts`, `loading.tsx`, `error.tsx`, `not-found.tsx`, `default.tsx`, `proxy.ts`.
- Hooks live beside the component that uses them, or in `src/components/<area>/hooks/`, named `use-thing.ts` exporting `useThing`.
- Test files mirror their subject: `src/server/vault.ts` → `tests/server/vault.test.ts`. E2E specs are `e2e/<flow>.spec.ts`.
- Migrations: `supabase/migrations/<timestamp>_<snake_case_description>.sql`.
- No barrel `index.ts` files. They obscure the dependency graph and defeat tree-shaking. Import from the concrete path.

---

## Module / Component Structure

Every React component follows this order. Deviating makes files harder to scan
across a codebase this size.

```tsx
'use client' // only if genuinely needed

// 1. External packages
import { useState } from 'react'
import { ChevronDown } from 'lucide-react'

// 2. Internal absolute imports, grouped: lib → components → types
import { cn } from '@/lib/utils'
import { MODEL_CATALOG } from '@/lib/models'
import { Button } from '@/components/ui/button'
import type { Provider } from '@/types/domain'

// 3. Types for this file
type ModelPickerProps = {
  provider: Provider
  modelId: string
  availableProviders: readonly Provider[]
  onSelect: (provider: Provider, modelId: string) => void
}

// 4. Module constants
const MAX_VISIBLE_MODELS = 8

// 5. The component — named export, function declaration
export function ModelPicker({
  provider,
  modelId,
  availableProviders,
  onSelect,
}: ModelPickerProps) {
  const [open, setOpen] = useState(false)

  // 6. Derived values
  const models = MODEL_CATALOG[provider].slice(0, MAX_VISIBLE_MODELS)

  // 7. Handlers
  function handleSelect(nextModelId: string) {
    onSelect(provider, nextModelId)
    setOpen(false)
  }

  // 8. Render
  return (
    <Button
      variant="ghost"
      onClick={() => setOpen(!open)}
      className={cn('gap-xs', open && 'bg-canvas-soft')}
    >
      {modelId}
      <ChevronDown className="size-4 text-mute" />
    </Button>
  )
}

// 9. File-local helpers, below the component
function formatModelLabel(id: string): string {
  return id.replace(/-/g, ' ')
}
```

- Named exports only. No `export default` except in Next.js special files, where the framework requires it.
- One component per file. A subcomponent used only by its parent may live in the same file, below it — but if it grows past ~30 lines it moves to its own file.
- Props types are named `<ComponentName>Props` and declared in the same file.
- A component past ~150 lines is a signal to split. A component past 250 lines is a defect.
- Server-only modules in `src/server/` begin with `import 'server-only'` above every other import.

---

## Boundary Patterns

Every boundary returns the same error shape, so the client has exactly one thing
to handle:

```typescript
type ApiError = { error: string; code?: string }
```

`error` is safe to display to a user. `code` is a stable machine-readable
discriminator (`quota_exceeded`, `missing_key`, `budget_exhausted`,
`invalid_key`) that the client branches on.

### Route handler

```typescript
// src/app/api/prompts/route.ts
import { NextResponse } from 'next/server'

import { createPromptSchema } from '@/lib/schemas'
import { getUser } from '@/server/auth'
import { createPrompt } from '@/server/data/prompts'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  // 1. Authenticate. Always first, always before parsing.
  const user = await getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 2. Validate. Never trust the body.
  const parsed = createPromptSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', code: 'invalid_input' },
      { status: 400 },
    )
  }

  // 3. Delegate. No business logic in this file.
  try {
    const prompt = await createPrompt(user.id, parsed.data)
    return NextResponse.json(prompt, { status: 201 })
  } catch (error) {
    console.error('[api/prompts] create failed', error)
    return NextResponse.json(
      { error: 'Could not save prompt', code: 'internal_error' },
      { status: 500 },
    )
  }
}
```

- Order is fixed: authenticate → validate → delegate → respond.
- The `catch` logs the real error server-side and returns a generic message. A database error string never reaches the client.
- Status codes carry meaning: `400` invalid input, `401` no session, `403` authenticated but not permitted, `404` not found or not owned, `429` per-user quota, `503` global circuit breaker tripped.

### Data access module

```typescript
// src/server/data/conversations.ts
import 'server-only'

import { createServerSupabaseClient } from '@/server/supabase'
import type { Conversation } from '@/types/domain'

/** Returns null when the conversation does not exist or is not owned by the caller. */
export async function getConversation(id: string): Promise<Conversation | null> {
  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase
    .from('conversations')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    console.error('[data/conversations] getConversation failed', error)
    throw new Error('Failed to load conversation')
  }

  return data
}
```

- Every function creates its own request-scoped client. Clients are never held in module state.
- Ownership is enforced by RLS, not by adding `.eq('user_id', …)`. Adding it as well is harmless defence in depth, but it must never be the *only* protection.
- Supabase errors are logged with context and rethrown as a plain `Error`. Postgres error text is never surfaced to a caller.
- Use `.maybeSingle()` when zero rows is a valid outcome; `.single()` only when absence is genuinely an error.
- These functions return domain types, never raw Supabase response envelopes.

### Client-side mutation

```typescript
// src/components/prompts/use-create-prompt.ts
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import type { CreatePromptInput } from '@/lib/schemas'

export function useCreatePrompt() {
  const router = useRouter()
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function createPrompt(input: CreatePromptInput) {
    setIsPending(true)
    setError(null)

    try {
      const response = await fetch('/api/prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })

      if (!response.ok) {
        const body = (await response.json()) as { error: string }
        setError(body.error)
        return null
      }

      router.refresh()
      return await response.json()
    } catch {
      setError('Network error. Please try again.')
      return null
    } finally {
      setIsPending(false)
    }
  }

  return { createPrompt, isPending, error }
}
```

- Every mutation exposes `isPending` and `error`. A button that can be pressed twice during a request is a defect.
- `router.refresh()` after a successful mutation re-renders the Server Component tree with fresh data.
- The `catch` covers network failure only — HTTP errors are handled by the `!response.ok` branch.

---

## Error Handling

- Server-side logs are prefixed with the module in brackets: `console.error('[server/quota] breaker check failed', error)`. This makes production logs greppable.
- Never log a decrypted API key, a full request body containing one, or a Supabase service-role key. When logging an error from `src/server/keys.ts` or `src/server/vault.ts`, log the provider and user id, never the payload.
- User-facing messages are plain and actionable: "You've used your 20 free messages for today. Add your own API key to keep going." Not "Error 429" and not a stack trace.
- Distinguish expected failures from bugs. A quota refusal, a missing key, and an invalid key are expected — they get typed error classes (`QuotaExceededError`, `MissingKeyError`, `InvalidKeyError`) and specific status codes. Everything else is a `500` with a generic message.
- A streaming response that fails mid-stream writes the partial content with `status = 'error'` and `error_message` set, so the thread shows what happened rather than a message that silently vanishes.
- Provider API failures are surfaced with the provider named ("Anthropic returned an error") but never with the provider's raw error body, which can echo request contents.
- An error boundary (`error.tsx`) exists at the `(app)` route group level so one failing panel cannot blank the whole workspace.

---

## Environment Variables

Secrets are validated once at startup by **`src/server/env.ts`** (server-only,
`import 'server-only'` at the top) using zod. Public values live in
`src/lib/constants.ts`. The application fails to boot on a missing or malformed
variable rather than failing at the first request that needs it.

The split is not cosmetic: `src/lib/` is importable from Client Components, so a
secret read there would be bundled and shipped to the browser. Nothing under
`src/lib/` may reference a secret variable.

| Variable | Used In | Secret? |
| -------- | ------- | ------- |
| `NEXT_PUBLIC_SUPABASE_URL` | Browser and server Supabase clients | No — public by design |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Browser and server Supabase clients. Format `sb_publishable_…` | No — safe to expose; RLS is the protection |
| `NEXT_PUBLIC_SITE_URL` | OAuth redirect target, share-link generation. In production this is the Render URL (`https://<service>.onrender.com`) or the custom domain | No |
| `PORT` | Injected by Render; `next start` binds to it automatically | No — never set manually |
| `SUPABASE_SECRET_KEY` | `src/server/env.ts` → `src/server/supabase.ts`, reachable only from `src/server/quota.ts`. Format `sb_secret_…` | **Yes** — assumes `service_role`, bypassing RLS entirely |
| `ENCRYPTION_KEY` | `src/server/env.ts` → `src/server/vault.ts` only. 32 bytes, base64-encoded | **Yes** — compromise exposes every stored user key |
| `SHARED_GEMINI_API_KEY` | `src/server/env.ts` → `src/server/providers.ts` only | **Yes** — this is your billed key |
| `SHARED_KEY_DAILY_MESSAGE_LIMIT` | `src/lib/constants.ts`. Default `20` | No |
| `SHARED_KEY_MONTHLY_USD_CEILING` | `src/lib/constants.ts`. Default `10` | No |

**On Supabase key naming.** These are the current names. `anon` and `service_role`
are the legacy JWT keys, deprecated by end of 2026 — both still work, and the old
ones stay valid until explicitly disabled in the dashboard, but new code uses
`sb_publishable_…` and `sb_secret_…`.

Do not confuse the **API keys** with the **Postgres roles**. The roles are
unchanged: RLS policies still target `anon`, `authenticated`, and `service_role`,
and every `create policy … to anon` in the migrations is still correct. Only the
key names moved. A publishable key still authenticates as the `anon` role; a
secret key still assumes `service_role`, which is why
`createServiceRoleClient()` keeps that name — it describes the privilege level,
not the key format.

- Never hardcode a key, URL, or secret in source. Never commit `.env.local`.
- Only genuinely public values carry the `NEXT_PUBLIC_` prefix. Adding that prefix to a secret ships it to every browser — treat it as a one-way door.
- `.env.example` lists every variable above with a placeholder value and stays in sync with this table.
- Generate `ENCRYPTION_KEY` with `openssl rand -base64 32`. Rotating it invalidates every stored key, so rotation requires a re-encryption migration, not just a new value.
- On Render, declare secrets in the dashboard or as `sync: false` entries in `render.yaml` — **never** as literal values in `render.yaml`, which is committed to the repository.
- `NEXT_PUBLIC_*` variables are inlined at **build** time, not read at runtime. Changing `NEXT_PUBLIC_SITE_URL` on Render requires a rebuild, not just a restart. Forgetting this produces an OAuth redirect to the old URL with no error to explain it.

---

## Shared Constants

Every limit, threshold, and fixed identifier lives here. A number that appears
inline at a call site is a defect.

```typescript
// src/lib/constants.ts

/** The model served by the shared key. Nothing else is available without a personal key. */
export const SHARED_MODEL_ID = 'gemini-2.5-flash' as const

/** Per-user shared-key allowance, resetting at 00:00 UTC. */
export const SHARED_KEY_DAILY_MESSAGE_LIMIT = Number(
  process.env.SHARED_KEY_DAILY_MESSAGE_LIMIT ?? 20,
)

/** Global monthly ceiling. Breaching it trips the circuit breaker for every user. */
export const SHARED_KEY_MONTHLY_USD_CEILING = Number(
  process.env.SHARED_KEY_MONTHLY_USD_CEILING ?? 10,
)

/** Show the quota warning in the composer at this many remaining messages. */
export const QUOTA_WARNING_THRESHOLD = 5

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024

/** Enforced server-side when the message is sent, not only in the composer. */
export const MAX_ATTACHMENTS_PER_MESSAGE = 4

/** Orphaned uploads older than this are reaped by the hourly pg_cron job. */
export const ATTACHMENT_ORPHAN_TTL_HOURS = 24

/** nanoid length for share slugs. ~71 bits — unguessable by enumeration. */
export const SHARE_SLUG_LENGTH = 12

/** Retries on a unique violation before the share request fails. Never unbounded. */
export const SHARE_SLUG_MAX_RETRIES = 3

export const ALLOWED_ATTACHMENT_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/pdf',
] as const

/**
 * Hard ceiling on a single provider call, enforced with an AbortSignal.
 * Render allows a 100-minute request, so the platform will not rescue us from
 * a hung upstream — this is the only thing that ends a stalled stream.
 */
export const STREAM_TIMEOUT_MS = 2 * 60 * 1000

/** Messages fetched per page when a thread is long enough to paginate. */
export const MESSAGE_PAGE_SIZE = 50

export const SEARCH_RESULT_LIMIT = 30

/** Conversation title generated from the first exchange, capped for the sidebar. */
export const MAX_TITLE_LENGTH = 60
```

---

## Design System Rules

`context/DESIGN.md` is the source of truth. These rules bind it to the code.

- Reference tokens by their semantic Tailwind name (`bg-canvas-soft`, `text-mute`, `rounded-sm`, `p-xl`). A raw hex value, an arbitrary value like `p-[13px]`, or a Tailwind default colour (`bg-zinc-800`, `text-gray-400`) in a component is a defect.
- The interface is **dark-only**. No `dark:` variants, no `prefers-color-scheme` media query, no theme toggle. The warm canvas is the only surface.
- There is no chromatic brand accent. Emphasis is achieved with the off-white `--color-primary`, surface contrast, and weight — never with colour.
- `--color-danger`, `--color-warn`, and `--color-success` are defined in `DESIGN.md` as **state-only** tokens. They exist for destructive confirmations, quota warnings, and success feedback. They must never be used for a call to action, a highlight, an icon that is not communicating state, or any decorative purpose. If a colour is saying anything other than "this went wrong / this needs attention / this worked", it is the wrong colour.
- Elevation is surface contrast plus a 1px `border-hairline`. Do not add `box-shadow` to cards, panels, or the sidebar. Modals and toasts may use a single soft shadow, and nothing else may.
- Button radius is `rounded-sm` (3px) or `rounded-md` (4px). `rounded-pill` is reserved for icon-only circular buttons and status chips.
- Type comes from the `DESIGN.md` scale, applied as one `text-*` utility per step (`text-display-md`, `text-body-sm`, `text-caption`, `text-code`, `text-button-md`, …). Each already carries its size, line-height, tracking and weight, so never pair one with a `font-*` weight, `leading-*`, or `tracking-*` class — and never reach for a Tailwind default step like `text-3xl`, whose 30px and zero tracking are not in this system. Headings use Inter at weight 400–500 — never weight 700. Code and model identifiers use `font-mono text-code`. Instrument Serif italic (`font-serif text-display-serif`) is reserved for rare editorial moments (the landing hero) and never appears in the application chrome.
- shadcn/ui components are restyled to these tokens on installation. Never leave a generated component with its default `zinc`/`slate` palette or its default `0.5rem` radius.
- All text must clear WCAG AA against `--color-canvas`. `--color-mute` is the lightest text permitted and is only for timestamps and fine print — never for body copy.
- Focus states are visible on every interactive element: a 1px `--color-primary` ring offset by 2px. Never `outline: none` without a replacement.
- **Mobile-first, two prefixes.** Write the mobile case unprefixed, then layer `tablet:` (768px) and `desktop:` (1024px). Tailwind's `sm:`/`md:`/`lg:`/`xl:`/`2xl:` are deleted from the theme and will not compile — if you reach for one, you are adding a breakpoint the design system does not have.
- **Nothing lives only on hover.** A control or piece of information revealed by `hover:` must be persistently visible under `pointer-coarse:`. Write the pair together — `opacity-0 hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100` — never the hover half alone. The test is simple: if a touch user cannot reach it, it is a defect, not a refinement.
- **Images always carry `unoptimized`.** Render runs the Next image optimizer inside the same Node process that serves streams, and its disk cache does not survive a redeploy. The correct sizes already exist in storage from upload time — `thumb_path` for chips, `inline_path` for the message column, `storage_path` only in the lightbox. Always pass explicit `width` and `height` so the layout does not shift.
- **Payload size is a first-order concern.** There is no CDN in front of the origin, so every byte ships from one region, from the process that is also streaming. Prefer a Server Component to a client one, and reach for `next/dynamic` for anything heavy that is not needed on first paint.
- **Do not infer input from width.** An iPad in landscape is 1024px and gets the `desktop:` layout, but it has no hover and needs 44px touch targets. Breakpoints decide layout; `pointer-coarse:` decides affordances and hit areas. The two are independent and must not be substituted for each other.

---

## Import Conventions

- Use the `@/` alias for everything under `src/`. Configure it once in `tsconfig.json`.
- Relative imports are permitted only within the same folder (`./message-bubble`). `../` is allowed one level; `../../` is forbidden — reach for the alias instead.
- Import order, separated by blank lines: React and Next → external packages → `@/lib` → `@/server` → `@/components` → `@/types` → relative. Enforced by `eslint-plugin-import`.
- Type-only imports use `import type { … }`, so the bundler can drop them cleanly.
- Never import from `src/server/` in a file that has `'use client'`, and never in a file under `src/components/`. If a Client Component needs server data, it arrives as a prop or through a `fetch`.

---

## Comments

- Comment *why*, never *what*. `// increment the counter` above `count++` is noise; `// atomic upsert — read-then-write undercounts under concurrent requests` is worth its line.
- Every non-obvious security or correctness decision gets a comment. The vault, the quota upsert, the RLS reliance in data modules, and the `runtime = 'nodejs'` declarations all warrant one.
- Public functions in `src/server/` get a one-line JSDoc stating what they return and when they return null or throw.
- No commented-out code. Git remembers it.
- No changelog comments (`// updated 2026-07-25`). Git remembers that too.
- `TODO:` comments must name what is missing and be resolved within the feature that introduced them. A `TODO` may not survive into a completed feature — if the work is genuinely deferred, it belongs in `build-plan.md`, not in a comment.

---

## Testing

- Vitest covers `src/server/`. The non-negotiable subjects: `vault.ts` (encrypt/decrypt round-trip, tamper detection, IV uniqueness, key-length validation), `quota.ts` (limit boundary at 19/20/21, breaker trip, slot release on failure, and a concurrency test firing N parallel reservations at the boundary to prove no over-issue), `providers.ts` (each provider resolves, missing key throws, non-Google without a key is refused), and `data/` modules against a local Supabase instance.
- RLS is tested, not assumed. At least one test signs in as user A and asserts that a direct query for user B's conversation returns zero rows using the anon key.
- Playwright covers four flows and no more: sign in with Google (against a seeded test user), send a message and receive a stream, add an API key and confirm only `last_four` is displayed, and exhaust the shared quota to see the wall.
- Tests describe behaviour, not implementation: `it('refuses the 21st shared-key message of the day')`, not `it('calls reserveSharedSlot')`.
- No test may make a real call to a paid provider API. Provider clients are mocked at the `resolveModel()` boundary.
- A feature is not complete until its tests pass. Never report a feature done with a failing or skipped test.

---

## Dependencies

Before installing anything new, check:

1. Does Next.js, React, or the standard library already do this? Date formatting, `crypto`, `fetch`, and `URLSearchParams` are all built in.
2. Is it already in the approved list below under a different name?
3. Does it work with React 19 Server Components, and does it need `'use client'`?
4. What is its install size and transitive dependency count? A 200KB dependency for one helper function is not worth it.
5. Is it maintained — a release within the last twelve months and an open issue tracker?

Approved dependencies for this project:

- `next` — v16, framework (Turbopack default)
- `react`, `react-dom` — v19.2
- `typescript` — v5.1+, strict
- `@supabase/supabase-js` — database and auth client
- `@supabase/ssr` — v0.12 (pinned to the minor: pre-1.0, and the cookie API is load-bearing for `src/proxy.ts`), cookie-based session handling for the App Router
- `ai` — v7, Vercel AI SDK core: `streamText`, UI message streams
- `@ai-sdk/react` — v4, the `useChat` hook
- `@ai-sdk/openai` — v4, OpenAI provider
- `@ai-sdk/anthropic` — v4, Anthropic provider
- `@ai-sdk/google` — v4, Google provider, used for both BYOK and the shared key
- `@openrouter/ai-sdk-provider` — v3, OpenRouter provider
- `zod` — v4, validation of route inputs and environment variables
- `tailwindcss` — v4, styling
- `clsx`, `tailwind-merge` — the `cn()` helper
- `class-variance-authority` — component variants, required by shadcn/ui
- `@radix-ui/*` — accessible primitives pulled in by shadcn/ui components as needed
- `lucide-react` — icons
- `react-markdown`, `remark-gfm` — assistant message rendering
- `shiki` — syntax highlighting in code blocks
- `sonner` — toasts
- `nanoid` — share-link slug generation
- `server-only` — enforces the server boundary at build time
- `vitest`, `@vitest/coverage-v8` — v4, unit tests
- `@playwright/test` — E2E tests
- `eslint`, `@next/eslint-plugin-next`, `eslint-plugin-import` — linting via the ESLint CLI with flat config (`next lint` was removed in v16). Carries import ordering *and* the `import/no-restricted-paths` zones that enforce the boundary invariants mechanically
- `prettier`, `prettier-plugin-tailwindcss` — formatting

Do not install any other packages without updating this list first.

Explicitly rejected, with reasons — do not reintroduce these without a decision recorded in `build-journal.md`:

- **A state management library** (Redux, Zustand, Jotai) — Server Components hold the data; client state is local and small.
- **An ORM** (Prisma, Drizzle) — `supabase-js` plus generated types covers it, and an ORM's own connection would bypass RLS.
- **A date library** (moment, date-fns, dayjs) — `Intl.DateTimeFormat` and `Intl.RelativeTimeFormat` handle every case here.
- **A crypto library** (crypto-js, node-forge) — `node:crypto` provides AES-256-GCM, and a hand-rolled or third-party crypto layer is a liability on a table full of other people's secrets.
- **A search service** (Algolia, Meilisearch, Typesense) — Postgres full-text search is the decided approach.
- **An analytics SDK** — the project ships no telemetry.
