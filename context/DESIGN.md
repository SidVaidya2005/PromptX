---
version: 1.0
name: PromptX-design-system
description: The design language for PromptX — a warm near-charcoal canvas (a tint warmer than pure black) broken only by clean Inter typography, DM Mono for anything technical, and the occasional Instrument Serif italic moment. There is no chromatic brand accent; an off-white carries every emphasis. Shape geometry runs tighter than most applications, and elevation comes from hairlines rather than shadow. Adapted from an analysis of Warp's design language.

colors:
  primary: "#f7f5f0"
  on-primary: "#2b2622"
  ink: "#f7f5f0"
  body: "#c9c0ad"
  body-strong: "#dad2c1"
  mute: "#aea69c"
  canvas: "#2b2622"
  canvas-soft: "#383330"
  hairline: "#3f3a36"
  # State-only extensions. Not part of the inherited brand — added because an
  # application needs destructive confirmations, quota warnings, and success
  # feedback. Warm-tinted so they sit inside the palette. Reserved exclusively
  # for communicating state; never for emphasis, CTAs, or decoration.
  danger: "#d8735e"
  warn: "#d6a962"
  success: "#8fae7e"

typography:
  display-xl:
    fontFamily: Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif
    fontSize: 64px
    fontWeight: 400
    lineHeight: 70.4px
    letterSpacing: -1.6px
  display-lg:
    fontFamily: Inter, system-ui, -apple-system, sans-serif
    fontSize: 48px
    fontWeight: 400
    lineHeight: 52.8px
    letterSpacing: -1.2px
  display-md:
    fontFamily: Inter, system-ui, -apple-system, sans-serif
    fontSize: 32px
    fontWeight: 500
    lineHeight: 40px
    letterSpacing: -0.8px
  display-sm:
    fontFamily: Inter, system-ui, -apple-system, sans-serif
    fontSize: 24px
    fontWeight: 500
    lineHeight: 32px
    letterSpacing: -0.4px
  display-serif:
    fontFamily: Instrument Serif, Georgia, "Times New Roman", serif
    fontSize: 48px
    fontWeight: 400
    lineHeight: 52px
    letterSpacing: -0.5px
  body-lg:
    fontFamily: Inter, system-ui, -apple-system, sans-serif
    fontSize: 18px
    fontWeight: 400
    lineHeight: 28px
  body-md:
    fontFamily: Inter, system-ui, -apple-system, sans-serif
    fontSize: 16px
    fontWeight: 400
    lineHeight: 24px
  body-md-strong:
    fontFamily: Inter, system-ui, -apple-system, sans-serif
    fontSize: 16px
    fontWeight: 500
    lineHeight: 24px
  body-sm:
    fontFamily: Inter, system-ui, -apple-system, sans-serif
    fontSize: 14px
    fontWeight: 400
    lineHeight: 20px
  body-sm-strong:
    fontFamily: Inter, system-ui, -apple-system, sans-serif
    fontSize: 14px
    fontWeight: 500
    lineHeight: 20px
  caption:
    fontFamily: Inter, system-ui, -apple-system, sans-serif
    fontSize: 12px
    fontWeight: 400
    lineHeight: 16px
  code:
    fontFamily: DM Mono, ui-monospace, SFMono-Regular, Menlo, monospace
    fontSize: 13px
    fontWeight: 400
    lineHeight: 18px
  code-md:
    fontFamily: DM Mono, ui-monospace, SFMono-Regular, Menlo, monospace
    fontSize: 14px
    fontWeight: 400
    lineHeight: 20px
  button-md:
    fontFamily: Inter, system-ui, -apple-system, sans-serif
    fontSize: 14px
    fontWeight: 500
    lineHeight: 20px

rounded:
  none: 0px
  xxs: 1px
  xs: 2px
  sm: 3px
  md: 4px
  lg: 6px
  pill: 9999px
  full: 9999px

spacing:
  xxs: 2px
  xs: 4px
  sm: 8px
  md: 10px
  lg: 16px
  xl: 24px
  2xl: 32px
  3xl: 48px
  4xl: 64px
  5xl: 96px

components:
  # ─── Application shell ───
  app-shell:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body-md}"
  sidebar:
    backgroundColor: "{colors.canvas}"
    borderColor: "{colors.hairline}"
    textColor: "{colors.body}"
    typography: "{typography.body-sm}"
    padding: "{spacing.sm}"
    width: 260px
  sidebar-row:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.body-strong}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.sm}"
    padding: "{spacing.sm} {spacing.md}"
    hoverBackground: "{colors.canvas-soft}"
    activeBackground: "{colors.canvas-soft}"
    activeIndicator: "{colors.primary}"
    activeTextColor: "{colors.ink}"
  sidebar-group-label:
    textColor: "{colors.mute}"
    typography: "{typography.caption}"
    padding: "{spacing.lg} {spacing.md} {spacing.xs}"
  sidebar-footer:
    backgroundColor: "{colors.canvas}"
    borderColor: "{colors.hairline}"
    textColor: "{colors.body}"
    typography: "{typography.body-sm}"
    padding: "{spacing.sm} {spacing.md}"

  # ─── Thread ───
  message-user:
    backgroundColor: "{colors.canvas-soft}"
    textColor: "{colors.ink}"
    borderColor: "{colors.hairline}"
    typography: "{typography.body-md}"
    rounded: "{rounded.md}"
    padding: "{spacing.md} {spacing.lg}"
  message-assistant:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.body-strong}"
    typography: "{typography.body-md}"
    padding: "{spacing.lg} 0"
  message-meta:
    textColor: "{colors.mute}"
    typography: "{typography.code}"
    padding: "{spacing.xs} 0"
  message-error:
    backgroundColor: "{colors.canvas-soft}"
    textColor: "{colors.danger}"
    borderColor: "{colors.danger}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    padding: "{spacing.md} {spacing.lg}"
  code-block:
    backgroundColor: "{colors.canvas-soft}"
    textColor: "{colors.ink}"
    borderColor: "{colors.hairline}"
    typography: "{typography.code}"
    rounded: "{rounded.md}"
    padding: "{spacing.lg}"
  code-block-header:
    backgroundColor: "{colors.canvas-soft}"
    textColor: "{colors.mute}"
    borderColor: "{colors.hairline}"
    typography: "{typography.caption}"
    padding: "{spacing.xs} {spacing.md}"
  code-inline:
    backgroundColor: "{colors.canvas-soft}"
    textColor: "{colors.ink}"
    typography: "{typography.code}"
    rounded: "{rounded.xs}"
    padding: "{spacing.xxs} {spacing.xs}"

  # ─── Composer ───
  composer:
    backgroundColor: "{colors.canvas-soft}"
    borderColor: "{colors.hairline}"
    rounded: "{rounded.md}"
    padding: "{spacing.md}"
  composer-input:
    backgroundColor: "{colors.canvas-soft}"
    textColor: "{colors.ink}"
    placeholderColor: "{colors.mute}"
    typography: "{typography.body-md}"
    padding: "{spacing.sm} 0"
  composer-toolbar:
    textColor: "{colors.mute}"
    typography: "{typography.body-sm}"
    padding: "{spacing.xs} 0 0"
  attachment-chip:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.body}"
    borderColor: "{colors.hairline}"
    typography: "{typography.caption}"
    rounded: "{rounded.sm}"
    padding: "{spacing.xs} {spacing.sm}"

  # ─── Navigation & controls ───
  model-picker:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.body-strong}"
    borderColor: "{colors.hairline}"
    typography: "{typography.code-md}"
    rounded: "{rounded.sm}"
    padding: "{spacing.xs} {spacing.sm}"
  outline-rail:
    backgroundColor: "{colors.canvas}"
    borderColor: "{colors.hairline}"
    padding: "{spacing.sm}"
    width: 220px
  outline-rail-item:
    textColor: "{colors.mute}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.sm}"
    padding: "{spacing.xs} {spacing.sm}"
    hoverTextColor: "{colors.body-strong}"
    activeTextColor: "{colors.ink}"
    activeIndicator: "{colors.primary}"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button-md}"
    rounded: "{rounded.sm}"
    padding: "{spacing.sm} {spacing.lg}"
  button-secondary-ghost:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.button-md}"
    rounded: "{rounded.sm}"
    padding: "{spacing.sm} {spacing.lg}"
  button-outline:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    borderColor: "{colors.hairline}"
    typography: "{typography.button-md}"
    rounded: "{rounded.sm}"
    padding: "{spacing.sm} {spacing.lg}"
  button-danger:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.danger}"
    typography: "{typography.button-md}"
    rounded: "{rounded.sm}"
    padding: "{spacing.sm} {spacing.lg}"
  button-icon-circular:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    rounded: "{rounded.full}"
    padding: "{spacing.xs}"
  text-input:
    backgroundColor: "{colors.canvas-soft}"
    textColor: "{colors.ink}"
    borderColor: "{colors.hairline}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.sm}"
    padding: "{spacing.sm} {spacing.md}"

  # ─── Settings & status ───
  card-content:
    backgroundColor: "{colors.canvas-soft}"
    textColor: "{colors.ink}"
    borderColor: "{colors.hairline}"
    typography: "{typography.body-md}"
    rounded: "{rounded.md}"
    padding: "{spacing.xl}"
  key-row:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    borderColor: "{colors.hairline}"
    typography: "{typography.body-md-strong}"
    maskedKeyTypography: "{typography.code}"
    maskedKeyColor: "{colors.mute}"
    padding: "{spacing.lg} 0"
  quota-meter:
    backgroundColor: "{colors.canvas-soft}"
    textColor: "{colors.body}"
    warningTextColor: "{colors.warn}"
    exhaustedTextColor: "{colors.danger}"
    typography: "{typography.caption}"
    rounded: "{rounded.pill}"
    padding: "{spacing.xxs} {spacing.sm}"
  status-chip:
    backgroundColor: "{colors.canvas-soft}"
    textColor: "{colors.body}"
    typography: "{typography.caption}"
    rounded: "{rounded.pill}"
    padding: "{spacing.xxs} {spacing.sm}"
  prompt-card:
    backgroundColor: "{colors.canvas-soft}"
    textColor: "{colors.ink}"
    borderColor: "{colors.hairline}"
    typography: "{typography.body-md}"
    rounded: "{rounded.md}"
    padding: "{spacing.lg}"
  search-result-row:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.body}"
    borderColor: "{colors.hairline}"
    typography: "{typography.body-sm}"
    highlightColor: "{colors.ink}"
    padding: "{spacing.lg} 0"
  empty-state:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.mute}"
    typography: "{typography.body-md}"
    padding: "{spacing.3xl}"

  # ─── Overlays ───
  modal-card:
    backgroundColor: "{colors.canvas-soft}"
    textColor: "{colors.ink}"
    borderColor: "{colors.hairline}"
    typography: "{typography.body-md}"
    rounded: "{rounded.lg}"
    padding: "{spacing.xl}"
  toast:
    backgroundColor: "{colors.canvas-soft}"
    textColor: "{colors.ink}"
    borderColor: "{colors.hairline}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    padding: "{spacing.sm} {spacing.md}"
  dropdown-menu:
    backgroundColor: "{colors.canvas-soft}"
    textColor: "{colors.ink}"
    borderColor: "{colors.hairline}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    padding: "{spacing.xs}"
  tooltip:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.on-primary}"
    typography: "{typography.caption}"
    rounded: "{rounded.sm}"
    padding: "{spacing.xxs} {spacing.sm}"

  # ─── Marketing (landing page only) ───
  hero-band:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.display-xl}"
    padding: "{spacing.5xl} {spacing.xl}"
  nav-bar:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm-strong}"
    padding: "{spacing.md} {spacing.xl}"
  footer:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.body}"
    typography: "{typography.body-sm}"
    padding: "{spacing.3xl} {spacing.xl}"

---


## Overview

PromptX is an AI chat workspace, and its interface takes the posture of a
developer tool rather than a consumer product: a single warm dark band running
the entire application, warmer than pure black (`{colors.canvas}` `#2b2622`
carries a hint of brown-beige), with copy set almost entirely in Inter. The
workspace reads more like a reading-mode editor than a product surface.

The decoration is restrained to the point of absence. There are no gradients,
no atmospheric backdrops, and no illustration system. The three-column shell —
conversation sidebar, thread, outline rail — is separated by hairlines, not by
shadow or fill. What visual interest exists comes from typography and from the
contrast between `{colors.canvas}` and `{colors.canvas-soft}`.

Type is the second decisive voice. Body text is 16 px Inter at line-height 1.5,
tuned for reading long model responses. DM Mono carries everything technical:
code blocks, model identifiers, masked API keys, token counts. Instrument Serif
italic appears only on the landing page.

**This interface is dark-only.** There is no light theme, no `prefers-color-scheme`
branch, and no toggle. The warm dark canvas is the identity, and a light variant
would not be the same product.

**Key Characteristics:**
- A single primary "color" — really an off-white `{colors.primary}` (`#f7f5f0`) — that doubles as default text and as the button-primary fill. There is no chromatic brand accent.
- Warm dark canvas (`{colors.canvas}` `#2b2622`) is the only page surface. The brown-warmth is the defining tone, not pure black.
- Extremely tight button radii — 3 / 4 px — never generous pill shapes for actions. Only icon containers and status chips use `{rounded.full}`.
- Inter sans + DM Mono is the canonical pairing, with a strict role split: Inter narrates, DM Mono is technical.
- Elevation is surface contrast plus 1 px hairlines. Drop shadows appear only on overlays.
- A subtle warm tint runs through every neutral; even body text and dividers carry warmth rather than neutral gray.

## Colors

### Brand & Accent
- **Off White Primary** (`{colors.primary}` — `#f7f5f0`): The "primary" is a warm off-white. Used as button-primary fill, as default text on canvas, as the active indicator in the sidebar and outline rail, and as the focus ring. There is no chromatic brand accent — the off-white IS the distinguishing tone.

### Surface
- **Canvas** (`{colors.canvas}` — `#2b2622`): The warm dark background. Resolved from `oklch(22.0% 0.004 84.6)`. Slightly browner than pure black, slightly warmer than a neutral gray — the warmth IS the identity.
- **Canvas Soft** (`{colors.canvas-soft}` — `#383330`): A lighter warm-dark fill used for user messages, the composer, cards, code blocks, and overlay surfaces.
- **Hairline** (`{colors.hairline}` — `#3f3a36`): 1 px solid divider. The primary tool for structure in the shell.

### Text
- **Ink** (`{colors.ink}` — `#f7f5f0`): Default text — same off-white as the primary, intentionally unified.
- **Body Strong** (`{colors.body-strong}` — `#dad2c1`): Assistant message body. The workhorse for long-form reading.
- **Body** (`{colors.body}` — `#c9c0ad`): Secondary text — sidebar rows, captions, supporting copy.
- **Mute** (`{colors.mute}` — `#aea69c`): Lowest-priority text — timestamps, model metadata, placeholders, fine print. Resolved from `oklch(71.5% 0.008 84.6)`. Never used for body copy.

### State
Three colors exist beyond the inherited brand, because an application needs to
communicate destructive intent, quota pressure, and success. They are warm-tinted
to sit inside the palette rather than fight it.

- **Danger** (`{colors.danger}` — `#d8735e`): Destructive confirmations, message error states, exhausted quota.
- **Warn** (`{colors.warn}` — `#d6a962`): Approaching the shared-key daily limit.
- **Success** (`{colors.success}` — `#8fae7e`): Key validated, conversation shared, export complete.

**These are state-only.** They never appear on a call-to-action, never highlight
non-state content, and never decorate. If a color is communicating something
other than "this went wrong / this needs attention / this worked", it is the
wrong color.

## Typography

### Font Family
Three faces ladder the system:
1. **Inter** for every display, body, button, link, and label role. Weights 400 / 500 are the working pair.
2. **DM Mono** for code blocks, inline code, model identifiers, masked API keys, and token counts. Weight 400 only.
3. **Instrument Serif** for occasional editorial italic moments on the landing page. It does not appear in the application chrome.

### Hierarchy

| Token | Size | Weight | Line Height | Letter Spacing | Use |
|---|---|---|---|---|---|
| `{typography.display-xl}` | 64px | 400 | 70.4px | -1.6px | Landing hero headline. |
| `{typography.display-lg}` | 48px | 400 | 52.8px | -1.2px | Landing section headlines. |
| `{typography.display-md}` | 32px | 500 | 40px | -0.8px | Settings page titles, empty-state headings. |
| `{typography.display-sm}` | 24px | 500 | 32px | -0.4px | Dialog titles, card titles. |
| `{typography.display-serif}` | 48px | 400 | 52px | -0.5px | Instrument Serif italic, landing page only. |
| `{typography.body-lg}` | 18px | 400 | 28px | 0 | Landing lead paragraphs. |
| `{typography.body-md}` | 16px | 400 | 24px | 0 | Message body — user and assistant. |
| `{typography.body-md-strong}` | 16px | 500 | 24px | 0 | Bold inline body, settings row labels. |
| `{typography.body-sm}` | 14px | 400 | 20px | 0 | Sidebar rows, outline rail, secondary UI. |
| `{typography.body-sm-strong}` | 14px | 500 | 20px | 0 | Nav link and button labels. |
| `{typography.caption}` | 12px | 400 | 16px | 0 | Timestamps, group labels, quota meter, fine print. |
| `{typography.code}` | 13px | 400 | 18px | 0 | Code blocks, inline code, model metadata, masked keys. |
| `{typography.code-md}` | 14px | 400 | 20px | 0 | Model picker label. |
| `{typography.button-md}` | 14px | 500 | 20px | 0 | Button labels. |

### Principles
- **Display at weight 400** — quietly confident, never a billboard. Never weight 700.
- **Negative tracking is part of the voice.** `-1.6 px` at 64 px, scaling down through display levels.
- **Inter narrates, DM Mono is technical.** Strict role separation. A model id set in Inter is a bug.

### Note on Font Substitutes
All three faces are open and load from Google Fonts: **Inter**, **DM Mono**, and
**Instrument Serif**. Load them through `next/font/google` so they self-host and
carry no layout shift.

## Layout

### Spacing System
- **Base unit**: 4 px (with 10 px and 6 px values for control padding).
- **Tokens**: `{spacing.xxs}` 2 px · `{spacing.xs}` 4 px · `{spacing.sm}` 8 px · `{spacing.md}` 10 px · `{spacing.lg}` 16 px · `{spacing.xl}` 24 px · `{spacing.2xl}` 32 px · `{spacing.3xl}` 48 px · `{spacing.4xl}` 64 px · `{spacing.5xl}` 96 px.
- **Landing bands**: `{spacing.5xl}` 96 px on desktop.
- **Card interior**: `{spacing.xl}` 24 px.
- **Application chrome**: `{spacing.sm}`–`{spacing.md}`. The shell runs tighter than the marketing surface.

### Grid & Container
- **Application shell**: three columns — sidebar 260 px fixed, thread fluid, outline rail 220 px fixed. Both side columns collapse.
- **Thread measure**: the message column caps at roughly 720 px and centres within the fluid middle, so long responses stay readable on a wide display.
- **Compare view**: two equal columns with a hairline between them.
- **Landing**: content centres at roughly 1200 px.

### Responsive Strategy

#### Breakpoints

| Name | Width | Key Changes |
|---|---|---|
| Mobile | < 768px | Sidebar becomes a drawer; outline rail becomes a sheet; compare columns stack. |
| Tablet | 768–1023px | Sidebar collapsible and overlaid; outline rail hidden by default. |
| Desktop | ≥ 1024px | Full three-column shell; compare side by side. |

#### Touch Targets
Controls render at ~36 px tall (8 px vertical padding + 20 px line-height).
Mobile inflates touch area with additional padding to meet the WCAG 44 × 44 px
floor. Sidebar rows and outline items get generous vertical padding on touch.

#### Collapsing Strategy
- Sidebar: persistent at desktop, overlay drawer below 1024 px, collapse state persisted.
- Outline rail: persistent at desktop, sheet from the thread header below 1024 px, hidden entirely below three exchanges.
- Composer: stays pinned to the bottom of the thread column at every width.

#### Image Behavior
- **Attachment thumbnails**: square crop inside `{rounded.sm}` chrome, 40 px in the composer.
- **Inline message images**: max-width 100% of the message column, `{rounded.md}`, opening to a lightbox.
- **Avatars**: 1:1 inside `{rounded.full}`, 24 px in the sidebar footer.

## Elevation & Depth

| Level | Treatment | Use |
|---|---|---|
| Level 0 — Flat | No shadow, no border. | Canvas, assistant messages, thread background. |
| Level 1 — Hairline | 1 px solid `{colors.hairline}` border on `{colors.canvas-soft}`. | Cards, user messages, composer, code blocks. |
| Level 2 — Divider | 1 px `{colors.hairline}` with no fill change. | Column separators, settings rows, search results. |
| Level 3 — Overlay | `{colors.canvas-soft}` fill, hairline border, single soft shadow. | Modals, dropdowns, toasts, tooltips. **The only place shadow appears.** |

Structure comes from surface contrast and hairlines. A shadow on a card, a panel,
or the sidebar is a defect.

## Shapes

### Border Radius Scale

| Token | Value | Use |
|---|---|---|
| `{rounded.none}` | 0px | Full-bleed bands, column edges. |
| `{rounded.xxs}` | 1px | Tightest in-text indicator. |
| `{rounded.xs}` | 2px | Inline code, very-small chips. |
| `{rounded.sm}` | 3px | Default button radius, sidebar rows, inputs — extremely tight. |
| `{rounded.md}` | 4px | Card chrome, messages, code blocks, composer. |
| `{rounded.lg}` | 6px | Modals. |
| `{rounded.pill}` | 9999px | Icon containers, status chips, quota meter, avatars. |

### Media Geometry
- Attachment thumbnails: 1:1 inside `{rounded.sm}`.
- Inline images: natural aspect ratio inside `{rounded.md}`.
- Avatars: 1:1 inside `{rounded.full}`.

## Components

### Application Shell

**`app-shell`** — the three-column frame.
- Background `{colors.canvas}`, text `{colors.ink}`. Columns separated by 1 px `{colors.hairline}`. No shadow anywhere in the shell.

**`sidebar`** — the conversation list column.
- Background `{colors.canvas}`, right border `{colors.hairline}`, 260 px fixed, padding `{spacing.sm}`. Scrolls independently of the thread.

**`sidebar-row`** — one conversation.
- Text `{colors.body-strong}`, `{typography.body-sm}`, shape `{rounded.sm}`, padding `{spacing.sm} {spacing.md}`. Title truncates to one line. Hover fills `{colors.canvas-soft}`. Active fills `{colors.canvas-soft}`, sets text `{colors.ink}`, and shows a 2 px `{colors.primary}` left indicator.

**`sidebar-group-label`** — "Pinned", "Today", "Previous 7 days", "Older".
- Text `{colors.mute}`, `{typography.caption}`, padding `{spacing.lg} {spacing.md} {spacing.xs}`. Sentence case with mute color carries the hierarchy; uppercase is not used.

**`sidebar-footer`** — avatar, name, and menu trigger.
- Background `{colors.canvas}`, top border `{colors.hairline}`, padding `{spacing.sm} {spacing.md}`.

### Thread

**`message-user`** — a prompt the user sent.
- Background `{colors.canvas-soft}`, text `{colors.ink}`, 1 px `{colors.hairline}`, `{typography.body-md}`, shape `{rounded.md}`, padding `{spacing.md} {spacing.lg}`. Right-aligned, max-width ~80% of the message column.

**`message-assistant`** — a model response.
- No fill, no border. Text `{colors.body-strong}`, `{typography.body-md}`, padding `{spacing.lg}` vertical. Full width of the message column. The absence of chrome is deliberate: responses are the content, not a card.

**`message-meta`** — the model that produced a response, token counts, timestamp.
- Text `{colors.mute}`, `{typography.code}` (DM Mono). Revealed on hover.

**`message-error`** — a failed or interrupted response.
- Background `{colors.canvas-soft}`, text and 1 px border `{colors.danger}`, `{typography.body-sm}`, shape `{rounded.md}`. Shows whatever partial content arrived above the error line.

**`code-block`** — a fenced code block in a response.
- Background `{colors.canvas-soft}`, 1 px `{colors.hairline}`, `{typography.code}` (DM Mono 13 px), shape `{rounded.md}`, padding `{spacing.lg}`. Header strip carries the language label in `{typography.caption}` `{colors.mute}` and a copy button. Syntax theme retuned to this palette — a stock theme reintroduces chromatic accents the system does not use.

**`code-inline`** — inline code.
- Background `{colors.canvas-soft}`, text `{colors.ink}`, `{typography.code}`, shape `{rounded.xs}`, padding `{spacing.xxs} {spacing.xs}`.

### Composer

**`composer`** — the message input container.
- Background `{colors.canvas-soft}`, 1 px `{colors.hairline}`, shape `{rounded.md}`, padding `{spacing.md}`. Pinned to the bottom of the thread column. The border brightens to `{colors.mute}` on focus-within.

**`composer-input`** — the auto-growing textarea.
- Transparent fill, text `{colors.ink}`, placeholder `{colors.mute}`, `{typography.body-md}`. Grows to a cap of ~40% viewport height, then scrolls.

**`composer-toolbar`** — model picker, attach button, quota meter, send.
- Text `{colors.mute}`, `{typography.body-sm}`, padding `{spacing.xs}` top.

**`attachment-chip`** — a pending upload.
- Background `{colors.canvas}`, text `{colors.body}`, 1 px `{colors.hairline}`, `{typography.caption}`, shape `{rounded.sm}`. Carries a thumbnail or file icon and a remove control.

### Navigation & Controls

**`model-picker`** — the current model, in the composer toolbar.
- Background `{colors.canvas}`, text `{colors.body-strong}`, 1 px `{colors.hairline}`, `{typography.code-md}` (DM Mono — it is a technical identifier), shape `{rounded.sm}`, padding `{spacing.xs} {spacing.sm}`.

**`outline-rail`** — the right column listing the user's prompts in the thread.
- Background `{colors.canvas}`, left border `{colors.hairline}`, 220 px fixed, padding `{spacing.sm}`.

**`outline-rail-item`** — one jump target.
- Text `{colors.mute}`, `{typography.body-sm}`, shape `{rounded.sm}`, padding `{spacing.xs} {spacing.sm}`. Truncates to two lines. Hover lifts text to `{colors.body-strong}`; the item matching the current scroll position sets `{colors.ink}` with a 2 px `{colors.primary}` left indicator.

**`button-primary`** — the off-white CTA.
- Background `{colors.primary}`, text `{colors.on-primary}`, `{typography.button-md}`, padding `{spacing.sm} {spacing.lg}`, shape `{rounded.sm}` 3 px. Tight.

**`button-secondary-ghost`** — the default application button.
- Transparent fill, text `{colors.ink}`, hover fills `{colors.canvas-soft}`. Same typography and shape.

**`button-outline`** — a bordered secondary.
- Transparent fill, 1 px `{colors.hairline}`, text `{colors.ink}`.

**`button-danger`** — destructive actions only.
- Transparent fill, text `{colors.danger}`, hover fills `{colors.danger}` at 10% opacity. Never a solid danger fill — that reads as a primary CTA.

**`button-icon-circular`** — the circular icon container.
- Background `{colors.canvas}`, ink icon, shape `{rounded.full}`. Always carries an accessible name.

**`text-input`** — the standard input.
- Background `{colors.canvas-soft}`, text `{colors.ink}`, 1 px `{colors.hairline}`, `{typography.body-sm}`, shape `{rounded.sm}`, padding `{spacing.sm} {spacing.md}`.

### Settings & Status

**`card-content`** — the default content card.
- Background `{colors.canvas-soft}`, text `{colors.ink}`, 1 px `{colors.hairline}`, padding `{spacing.xl}`, shape `{rounded.md}`.

**`key-row`** — one provider's API key on the settings page.
- No fill; sits on the canvas with a 1 px bottom `{colors.hairline}`. Provider name in `{typography.body-md-strong}` `{colors.ink}`; the masked key in `{typography.code}` `{colors.mute}` (`sk-…4f2a`). Padding `{spacing.lg}` vertical. Actions right-aligned as ghost buttons, with Remove in `button-danger`.

**`quota-meter`** — remaining shared-key messages.
- Background `{colors.canvas-soft}`, text `{colors.body}`, `{typography.caption}`, shape `{rounded.pill}`, padding `{spacing.xxs} {spacing.sm}`. Text shifts to `{colors.warn}` at the warning threshold and `{colors.danger}` at zero. The container never changes color — only the text does.

**`status-chip`** — "Shared", "Archived", "Pinned".
- Background `{colors.canvas-soft}`, text `{colors.body}`, `{typography.caption}`, shape `{rounded.pill}`.

**`prompt-card`** — one saved prompt in the library.
- Background `{colors.canvas-soft}`, 1 px `{colors.hairline}`, shape `{rounded.md}`, padding `{spacing.lg}`. Title in `{typography.body-md-strong}`, body preview in `{typography.body-sm}` `{colors.body}` clamped to three lines, tags as `status-chip`.

**`search-result-row`** — one message match.
- No fill; 1 px bottom `{colors.hairline}`, padding `{spacing.lg}` vertical. Snippet in `{typography.body-sm}` `{colors.body}`, with matched terms lifted to `{colors.ink}` at weight 500. Highlighting uses weight and brightness, never a background fill — a yellow `<mark>` would break the palette.

**`empty-state`** — no conversations, no prompts, no results.
- No fill, no border. Text `{colors.mute}`, `{typography.body-md}`, padding `{spacing.3xl}`, centred. A single sentence and at most one action. No illustration.

### Overlays

**`modal-card`** — dialog surface.
- Background `{colors.canvas-soft}`, 1 px `{colors.hairline}`, shape `{rounded.lg}`, padding `{spacing.xl}`. Single soft shadow permitted. Backdrop is `{colors.canvas}` at 70% opacity.

**`toast`** — transient feedback.
- Background `{colors.canvas-soft}`, 1 px `{colors.hairline}`, `{typography.body-sm}`, shape `{rounded.md}`. State color applies to the leading icon only, never the whole surface.

**`dropdown-menu`** — overflow and picker menus.
- Background `{colors.canvas-soft}`, 1 px `{colors.hairline}`, shape `{rounded.md}`, padding `{spacing.xs}`. Items use `sidebar-row` geometry.

**`tooltip`** — polarity-flipped for contrast.
- Background `{colors.ink}`, text `{colors.on-primary}`, `{typography.caption}`, shape `{rounded.sm}`.

### Marketing (landing page only)

**`hero-band`** — the signed-out hero.
- Background `{colors.canvas}`, headline `{typography.display-xl}` (64 px / 400 / `-1.6 px`), padding `{spacing.5xl} {spacing.xl}`. The one place `{typography.display-serif}` may appear, as an italic phrase inside the headline.

**`nav-bar`** — the landing top nav.
- Background `{colors.canvas}`, `{typography.body-sm-strong}`, padding `{spacing.md} {spacing.xl}`.

**`footer`** — the landing footer band.
- Background `{colors.canvas}`, text `{colors.body}`, `{typography.body-sm}`, padding `{spacing.3xl} {spacing.xl}`.

## Do's and Don'ts

### Do
- Reserve `{colors.primary}` off-white for primary CTAs, default text, active indicators, and focus rings. There is no chromatic accent.
- Use tight `{rounded.sm}` 3 px or `{rounded.md}` 4 px radii for buttons and cards.
- Set display type in Inter weight 400–500 with the specified negative tracking.
- Pair Inter (narrative) with DM Mono (code, model ids, masked keys, token counts). Keep the split strict.
- Keep the warm-dark canvas tone — pure black breaks the identity.
- Build elevation from surface contrast and hairlines.
- Give every interactive element a visible focus ring: 1 px `{colors.primary}`, offset 2 px against `{colors.canvas}`.
- Let `{colors.mute}` be the floor for text. Anything lower fails contrast.

### Don't
- Don't introduce a chromatic brand accent. Off-white on warm dark IS the voice.
- Don't use `{colors.danger}`, `{colors.warn}`, or `{colors.success}` for anything but state. They are not a palette to design with.
- Don't render display type at weight 700. The system is intentionally light.
- Don't use pill CTAs. Button radius is 3–4 px, almost rectangular. Pills are for icon containers and status chips only.
- Don't replace the warm dark canvas with neutral gray or pure black. The warmth IS the brand.
- Don't put a drop shadow on a card, panel, message, or the sidebar. Overlays only.
- Don't write a `dark:` variant or a `prefers-color-scheme` branch. There is one theme.
- Don't highlight search matches with a background fill. Use weight and brightness.
- Don't leave a shadcn/ui component with its generated `zinc` palette or `0.5rem` radius.
