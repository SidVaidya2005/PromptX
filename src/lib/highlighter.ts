/**
 * Syntax highlighting for fenced code in a response.
 *
 * This runs in the browser, which is a departure from `library-docs.md`'s
 * "on the server where possible" — here it is never possible. The thread lives
 * inside `Chat`, a Client Component holding `useChat` state, so a streaming
 * message does not exist on the server at render time, and after
 * `router.refresh()` even persisted messages re-render from client state. One
 * renderer for both is the only way they can agree.
 *
 * Everything below is arranged so the cost lands only on people who actually
 * read code:
 *
 *   - Shiki itself, the language index, and every grammar are dynamically
 *     imported. A conversation with no code fence downloads none of it.
 *   - The JavaScript RegExp engine replaces Oniguruma, which is ~1 MB of WASM
 *     for the same result on the grammars this app allows.
 *   - The highlighter is one module-level promise, so ten code blocks appearing
 *     at once share a single instance rather than racing to build ten.
 */

import type { HighlighterCore } from 'shiki/core'

import { PROMPTX_THEME_NAME, promptxTheme } from '@/lib/shiki-theme'

/**
 * The languages worth highlighting, as shiki's own canonical ids.
 *
 * The list is a compatibility guarantee, not a bundle-size one — lazy loading
 * already handles size. The JavaScript RegExp engine cannot emulate every
 * Oniguruma pattern, and `forgiving: true` would paper over that by silently
 * dropping the patterns it fails to parse. So this allowlist is exactly the set
 * proven to load and tokenise in `tests/lib/highlighter.test.ts`, and adding to
 * it means extending that test.
 *
 * Note `shellscript`, not `bash`: in shiki, `bash` is an *alias*. Using it as a
 * key here would work by accident today and break the alias table below.
 */
const SUPPORTED_LANGUAGES = [
  'typescript',
  'tsx',
  'javascript',
  'jsx',
  'python',
  'sql',
  'shellscript',
  'json',
  'go',
  'rust',
  'css',
  'html',
] as const

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]

const SUPPORTED = new Set<string>(SUPPORTED_LANGUAGES)

/**
 * What people actually type after three backticks, mapped to a canonical id.
 *
 * Transcribed from shiki's own `bundledLanguagesInfo` rather than guessed, and
 * pinned by a test that reads that same metadata — if a future shiki drops or
 * moves an alias, the test fails instead of the product quietly rendering a
 * `py`-labelled block as plain text.
 */
const ALIASES: Record<string, SupportedLanguage> = {
  ts: 'typescript',
  cts: 'typescript',
  mts: 'typescript',
  js: 'javascript',
  cjs: 'javascript',
  mjs: 'javascript',
  py: 'python',
  rs: 'rust',
  bash: 'shellscript',
  sh: 'shellscript',
  shell: 'shellscript',
  zsh: 'shellscript',
}

/**
 * Resolves a fence's language label to something the highlighter can load.
 *
 * Returns null for anything unrecognised, which is a rendering decision rather
 * than a failure: the block still renders, still copies, and still shows the
 * label the model wrote. Pure and synchronous so the render path can call it
 * without waiting on anything.
 */
export function normaliseLanguage(fence: string): SupportedLanguage | null {
  const key = fence.trim().toLowerCase()

  if (SUPPORTED.has(key)) return key as SupportedLanguage

  return ALIASES[key] ?? null
}

let highlighterPromise: Promise<HighlighterCore> | null = null

function getHighlighter(): Promise<HighlighterCore> {
  // Assigned before the first await so a second caller arriving mid-import
  // joins this promise instead of starting its own.
  highlighterPromise ??= (async () => {
    const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([
      import('shiki/core'),
      import('shiki/engine/javascript'),
    ])

    return createHighlighterCore({
      themes: [promptxTheme],
      langs: [],
      engine: createJavaScriptRegexEngine(),
    })
  })()

  return highlighterPromise
}

const loadedLanguages = new Map<SupportedLanguage, Promise<void>>()

function loadLanguage(
  highlighter: HighlighterCore,
  language: SupportedLanguage,
): Promise<void> {
  const existing = loadedLanguages.get(language)
  if (existing) return existing

  // `bundledLanguages` is a map of importers, not of grammars — reading it
  // costs the index module, and only the entry called downloads a grammar.
  const loading = import('shiki/langs').then(({ bundledLanguages }) =>
    highlighter.loadLanguage(bundledLanguages[language]),
  )

  loadedLanguages.set(language, loading)

  return loading
}

/**
 * Highlights one block, returning the inner markup only.
 *
 * `structure: 'inline'` is what makes the output safe to place inside the
 * `code-block` chrome: shiki emits token spans and nothing else, so it never
 * ships a competing `<pre>` with its own padding and background to fight the
 * one DESIGN.md specifies.
 *
 * The result goes through `dangerouslySetInnerHTML`, which is only acceptable
 * because shiki HTML-escapes every token's text — the sole markup in the string
 * is spans shiki generated itself. Model output reaching this function is
 * untrusted, and that escaping is the reason it stays inert.
 */
export async function highlight(code: string, language: SupportedLanguage): Promise<string> {
  const highlighter = await getHighlighter()

  await loadLanguage(highlighter, language)

  return highlighter.codeToHtml(code, {
    lang: language,
    theme: PROMPTX_THEME_NAME,
    structure: 'inline',
  })
}
