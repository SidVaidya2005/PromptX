# PromptX

An AI chat workspace with Google Sign-In. Chat with OpenAI, Anthropic, Google,
and OpenRouter models using your own API keys — encrypted at rest — or use a
shared Gemini key capped at 20 messages a day.

> **Status: design complete, implementation not started.**
> This repository currently contains documentation only. There is no application
> code yet. The full specification lives in [`context/`](./context), and the
> ordered build plan is in [`context/build-plan.md`](./context/build-plan.md).

## What it will do

- **One history across four providers.** Switch between GPT, Claude, Gemini, and OpenRouter models mid-conversation without leaving the thread.
- **Bring your own key.** Keys are AES-256-GCM encrypted server-side; the browser only ever sees the last four characters.
- **Usable in thirty seconds.** A shared Gemini key covers 20 messages a day for anyone who hasn't added a key yet.
- **Navigate long threads.** An outline rail lists every prompt in a conversation as a jump target.
- **Find anything.** Postgres full-text search across every message, ranked, with highlighted snippets.
- **Reusable prompts.** A tagged library, insertable into any conversation.
- **Compare models.** One prompt, two models, side by side — then continue with the winner.

## Stack

TypeScript · Next.js 16 (App Router) · Supabase (Postgres, Google OAuth, RLS,
Storage, pg_cron) · Vercel AI SDK v7 · Tailwind v4 + shadcn/ui · Vitest +
Playwright · deployed on **Render** as a single Node web service.

## Documentation

| File | Contents |
| --- | --- |
| [`context/project-overview.md`](./context/project-overview.md) | What the product is, who it's for, scope boundaries |
| [`context/architecture.md`](./context/architecture.md) | Stack, folder structure, data model, RLS policies, invariants |
| [`context/code-standards.md`](./context/code-standards.md) | Engineering rules every change must follow |
| [`context/library-docs.md`](./context/library-docs.md) | Project-specific usage patterns per library |
| [`context/build-plan.md`](./context/build-plan.md) | 8 phases, 38 features, in order |
| [`context/progress-tracker.md`](./context/progress-tracker.md) | Live build status |
| [`context/constraints.md`](./context/constraints.md) | What still binds, grouped by topic — read before any decision |
| [`context/build-journal.md`](./context/build-journal.md) | Dated archive of decisions, gotchas, and verification results per feature |
| [`context/DESIGN.md`](./context/DESIGN.md) | The design system — every colour, type scale, radius, spacing value |

Setup instructions, an architecture summary, and screenshots land here in
feature 38, once there is something to screenshot.

## Licence

MIT — see [LICENSE](./LICENSE).
