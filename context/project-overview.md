# Project Overview

> **Role:** Product source of truth — what this product is, who it's for, what's in and out of scope.
> **Read first**, before any other context file.
> **Relates to:** scope drives `build-plan.md`; progress tracked in `progress-tracker.md`.

## About the Project

PromptX is a personal AI chat workspace. A user signs in with Google and holds
long-form conversations with models from OpenAI, Anthropic, Google, and
OpenRouter — using their own API keys, which PromptX stores encrypted. Users
without a key of their own get a shared Gemini key capped at 5 messages a day,
so the product is usable within thirty seconds of signing in.

That figure was 20 until F38 deployed and measured the key it actually runs on.
Google's free tier grants **20 requests per day across every user**, not per
user, so a single visitor spending a 20-message allowance would consume the whole
project's daily quota and everybody after them would be refused by Google rather
than by PromptX. Five is what keeps the in-app wall the thing that fires.

Beyond chat, PromptX adds the things a heavy chat user actually misses: an
outline rail for jumping around inside a long thread, full-text search across
every message ever exchanged, a library of reusable prompts, and a compare view
that runs one prompt against two models side by side.

## The Problem It Solves

Anyone who uses more than one model pays for more than one subscription, and
their conversation history ends up split across three or four vendor websites
that cannot search each other. Switching models mid-problem means copying the
context by hand into a different tab. Meanwhile the API keys they already pay
for sit unused, because raw API access has no interface attached to it.

PromptX collapses that into one workspace: one history, one search index, one
prompt library, and a model picker that changes the provider without changing
anything else.

## Pages

- **Landing (`/`)** — signed-out marketing surface and the Google Sign-In entry point.
- **Chat (`/chat`, `/chat/[id]`)** — the primary workspace: conversation sidebar, thread, composer, and outline rail.
- **Compare (`/compare`)** — send one prompt to two models and read the answers side by side.
- **Prompts (`/prompts`)** — the saved prompt library: create, edit, tag, and delete reusable prompts.
- **Search (`/search`)** — ranked full-text results across every message the user owns.
- **Settings · Keys (`/settings/keys`)** — add, replace, and remove provider API keys; shows remaining shared-key quota.
- **Settings · Account (`/settings/account`)** — profile details and sign-out.
- **Shared conversation (`/share/[slug]`)** — public, read-only view of a conversation the owner chose to share.

## Navigation

The signed-in app is a persistent three-column shell. The left sidebar lists
conversations grouped by recency (Pinned · Today · Previous 7 days · Older) and
holds the links to Prompts, Search, and Settings. The centre column is the
active thread. The right column is the outline rail — a condensed list of the
user's own prompts in the current conversation, each one a jump target.

Both side columns collapse. Below 1024px the sidebar becomes a drawer and the
outline rail becomes a sheet triggered from the thread header.

Unauthenticated visits to any `/chat`, `/compare`, `/prompts`, `/search`, or
`/settings` route redirect to `/`. A successful sign-in lands on `/chat`.
`/share/[slug]` is the only route reachable without a session.

## Core User Flow

### Sign in

The visitor lands on `/`, presses "Continue with Google", and completes the
OAuth consent screen. Supabase Auth exchanges the code at `/auth/callback`, a
`profiles` row is created on first sign-in, and the user is redirected to
`/chat` with an empty state inviting them to start a conversation.

### Send the first message

The user types into the composer and sends. Because they have no API key yet,
PromptX resolves the request to the shared Gemini key, checks their daily
allowance, and streams the response token by token into the thread. The
conversation is persisted on the first message and a title is generated from
the exchange in the background. The new conversation appears at the top of the
sidebar.

### Hit the quota wall

Once the user has spent their 5 shared messages for the day, the composer
shows the limit and links to `/settings/keys`. Nothing is lost — the
conversation stays intact, and adding a key resumes it immediately.

### Add a personal key

On `/settings/keys` the user pastes an OpenAI, Anthropic, Google, or OpenRouter
key. The server validates it with a cheap probe call, encrypts it, and stores
the ciphertext. The page then shows only a masked preview (`sk-…4f2a`). The
model picker in the composer now offers that provider's models, and requests on
those models bypass the shared quota entirely.

### Work a long thread

As the conversation grows, the outline rail fills with the user's own prompts.
Clicking one scrolls the thread to that exchange. A prompt can be edited and
resent — which truncates the thread from that point and regenerates — or the
last answer can be regenerated, optionally against a different model.

### Reuse and retrieve

A good prompt gets saved to the library and inserted into any future
conversation from the composer. Weeks later, `/search` finds the exchange by
keyword, ranked, with the matching phrases highlighted.

## Data Architecture

### Identity

One `profiles` row per authenticated user, keyed to the Supabase `auth.users`
id. Every other user-owned row in the system carries a `user_id` that traces
back here, and every read is filtered by it at the database level.

### Secrets

Provider API keys live in their own table as ciphertext, never as plaintext,
one row per user per provider. The table also holds the last four characters of
the key so the interface has something to display without ever decrypting.

### Conversations

A conversation owns its title, its selected provider and model, an optional
system prompt, and its pinned / archived / shared state. Its messages are a
strictly linear, ordered list — there is no branching. Messages carry the model
that produced them and their token counts, which is what makes per-message
provenance and usage accounting possible.

### Attachments

Uploaded images and PDFs live in object storage under a per-user path prefix,
with a database row recording the mime type, size, and owning message.

### Prompt library

Free-standing reusable prompts owned by a user, tagged for filtering, with no
relationship to any conversation.

### Usage accounting

Two separate ledgers, deliberately kept apart. A per-user daily counter enforces
fairness on the shared key. A single global monthly row tracks total spend and
carries the circuit-breaker flag that disables the shared key for everyone when
the ceiling is breached.

## Features In Scope

- Google Sign-In via Supabase Auth, with per-user data isolation enforced by Row-Level Security
- Conversation CRUD: create, auto-title, rename, pin, archive, delete
- Streaming chat responses with a stop-generation control
- Markdown and syntax-highlighted code rendering with per-block copy buttons
- Bring-your-own API keys for OpenAI, Anthropic, Google, and OpenRouter, encrypted at rest
- A shared Gemini key with a 20 message/day per-user cap and a global monthly spend circuit breaker
- Per-message model selection, switchable mid-conversation
- Message outline rail for navigating long threads
- Edit-and-resend on user messages; regenerate on assistant messages
- Per-conversation system prompt
- Saved prompt library with tags, insertable into the composer
- Postgres full-text search across all of a user's messages, ranked with highlighted snippets
- Image and PDF attachments, gated by the selected model's capabilities
- Compare view: one prompt, two models, side by side, promotable into a real conversation
- Public read-only share links
- Conversation export as Markdown or JSON
- Dark-only interface built on the design tokens in `DESIGN.md`

## Features Out of Scope

- Light theme — `DESIGN.md` defines no light surfaces and the warm dark canvas is the brand
- Conversation branching or message trees — the compare view exists so that `messages` can stay linear
- Team workspaces, organisations, sharing with named collaborators, or any multi-user permission model
- Billing, subscriptions, or paid tiers
- Agentic tool use, function calling, code execution, or web browsing
- Retrieval over user documents (no embeddings, no vector store, no RAG)
- Voice input or speech output
- Native mobile or desktop applications
- Real-time collaboration or presence
- Admin dashboard or moderation tooling
- Self-hosted or local model support (Ollama, LM Studio)

## Target User

Developers and technical power users who already pay for at least one model API
and are tired of their history being scattered across vendor websites. They
know what a system prompt is, they have opinions about which model is better at
what, and they will notice whether the interface respects a keyboard. As a
portfolio piece, the secondary audience is an engineer reading the repository
to judge whether the author can build something real.

## Success Criteria

- A brand-new user can sign in with Google and receive a streamed answer without adding a key or reading any instructions.
- The message after the daily cap is refused with a clear message and a link to add a key; the one on the cap succeeds. Stated against `SHARED_KEY_DAILY_MESSAGE_LIMIT` rather than a literal, because F38 moved it from 20 to 5 and a criterion naming a number goes stale silently.
- When the global monthly budget ceiling is breached, the shared key stops serving every user, while users with their own keys are unaffected.
- No HTTP response anywhere in the application contains a decrypted provider API key. The only key material the client receives is `last_four`.
- Signed in as user A, no query, route, or crafted request returns any row belonging to user B — verified against RLS with the anon key, not just in application code.
- Changing the model mid-conversation preserves the full prior context and records the new model on subsequent messages only.
- Editing a user message truncates every message after it and regenerates from that point.
- Full-text search returns ranked results with highlighted snippets in under 500ms against a seeded database of 5,000 messages.
- A conversation with 200 messages scrolls smoothly, and every user prompt in it is a jump target in the outline rail.
- A public share link opens the conversation read-only in a logged-out browser and exposes no key, no email, and no other conversation.
- Every interactive surface is reachable and operable by keyboard, and all text meets WCAG AA contrast against the warm dark canvas.
- The application renders correctly from 360px to 1920px wide.
- `pnpm test` and `pnpm test:e2e` both pass from a clean checkout.
