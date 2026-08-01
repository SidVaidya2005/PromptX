import { bundledLanguagesInfo } from 'shiki/langs'
import { describe, expect, it } from 'vitest'

import { highlight, normaliseLanguage } from '@/lib/highlighter'

/**
 * The two things that can silently break highlighting.
 *
 * One: the JavaScript RegExp engine cannot emulate every Oniguruma pattern a
 * TextMate grammar might use, and a grammar it cannot parse throws at load.
 * There is a `forgiving` flag that swallows exactly that, which is why it is
 * not set — the failure has to be loud somewhere, and this is where.
 *
 * Two: the alias table is a hand-written copy of shiki's own metadata. If a
 * future version renames or drops an alias, nothing errors — blocks labelled
 * ```py just stop being highlighted, and nobody notices for months.
 *
 * Both are checked against the real packages. Nothing here is mocked.
 */

const SAMPLES: Record<string, string> = {
  typescript: 'const answer: number = 42 // a comment\nexport { answer }',
  tsx: 'export const App = () => <div className="x">{1 + 1}</div>',
  javascript: 'const answer = 42\nconsole.log(`${answer}`)',
  jsx: 'export const App = () => <div className="x">{1 + 1}</div>',
  python: 'def add(a: int, b: int) -> int:\n    """Docstring."""\n    return a + b',
  sql: "select id, title from conversations where user_id = $1 order by updated_at desc",
  shellscript: '#!/usr/bin/env bash\nset -euo pipefail\necho "hello ${NAME:-world}"',
  json: '{ "name": "promptx", "version": 1, "nested": { "ok": true } }',
  go: 'package main\n\nimport "fmt"\n\nfunc main() { fmt.Println("hi") }',
  rust: 'fn main() {\n    let xs = vec![1, 2, 3];\n    println!("{:?}", xs);\n}',
  css: '.thread { color: var(--color-ink); padding: 16px; }',
  html: '<section class="thread"><p>Hello &amp; welcome</p></section>',
}

describe('normaliseLanguage', () => {
  it('accepts a canonical id unchanged', () => {
    expect(normaliseLanguage('typescript')).toBe('typescript')
    expect(normaliseLanguage('shellscript')).toBe('shellscript')
  })

  it('resolves the aliases people actually type after three backticks', () => {
    expect(normaliseLanguage('ts')).toBe('typescript')
    expect(normaliseLanguage('js')).toBe('javascript')
    expect(normaliseLanguage('py')).toBe('python')
    expect(normaliseLanguage('rs')).toBe('rust')
    expect(normaliseLanguage('bash')).toBe('shellscript')
    expect(normaliseLanguage('sh')).toBe('shellscript')
  })

  it('is case- and whitespace-insensitive, because a fence label is free text', () => {
    expect(normaliseLanguage('  TypeScript ')).toBe('typescript')
    expect(normaliseLanguage('PY')).toBe('python')
  })

  it('returns null rather than throwing for a language we do not highlight', () => {
    // The block still renders and still copies. Returning null is a rendering
    // decision, not an error, so nothing above it needs a try/catch.
    expect(normaliseLanguage('brainfuck')).toBeNull()
    expect(normaliseLanguage('')).toBeNull()
    expect(normaliseLanguage('mermaid')).toBeNull()
  })

  it('agrees with shiki about what each alias means', () => {
    // Reads shiki's own metadata, so this fails on a version bump that moves an
    // alias rather than on a version bump that does not.
    const canonicalFor = new Map<string, string>()
    for (const language of bundledLanguagesInfo) {
      for (const alias of language.aliases ?? []) canonicalFor.set(alias, language.id)
    }

    for (const alias of ['ts', 'cts', 'mts', 'js', 'cjs', 'mjs', 'py', 'rs', 'bash', 'sh', 'shell', 'zsh']) {
      expect(canonicalFor.get(alias), `shiki's canonical id for \`${alias}\``).toBe(
        normaliseLanguage(alias),
      )
    }
  })
})

describe('highlight', () => {
  it.each(Object.entries(SAMPLES))(
    'loads the %s grammar under the JavaScript RegExp engine and emits tokens',
    async (language, sample) => {
      const resolved = normaliseLanguage(language)
      expect(resolved).not.toBeNull()

      const html = await highlight(sample, resolved!)

      // Tokens, not just echoed text: an unstyled passthrough would still
      // contain the source, so the assertion is on the colouring.
      expect(html).toContain('<span style="color:')
      expect(html).toMatch(/#f7f5f0|#dad2c1|#c9c0ad|#aea69c/i)
    },
  )

  it('emits no <pre> of its own, so the code-block chrome is the only one', () => {
    // structure: 'inline'. A second <pre> would arrive with shiki's own
    // padding and background and paint a rectangle inside DESIGN.md's.
    return expect(highlight('{ "a": 1 }', 'json')).resolves.not.toMatch(/<pre|<code/)
  })

  it('escapes markup in the source rather than emitting it', async () => {
    // The reason `dangerouslySetInnerHTML` is acceptable downstream. Model
    // output reaches this function and must come back inert.
    const html = await highlight('<img src=x onerror="alert(1)">', 'html')

    // The tag opener survives only as an entity, and tokenising splits it from
    // the tag name — so the check is that no `<` from the source became markup,
    // and that the one that mattered was escaped.
    expect(html).not.toContain('<img')
    expect(html).not.toMatch(/<(?!\/?span)/)
    expect(html).toContain('&#x3C;')
  })

  it('survives blocks of the same language highlighting concurrently', async () => {
    // An answer routinely holds several fences of one language, and they mount
    // in the same tick. Without the in-flight promise in the load map, each one
    // starts its own `loadLanguage` against the shared highlighter.
    //
    // That the instance is genuinely shared is not provable from in here; it is
    // asserted in the browser instead, where the network panel shows one
    // request per grammar.
    const results = await Promise.all([
      highlight('SELECT 1', 'sql'),
      highlight('SELECT 2', 'sql'),
      highlight('SELECT 3', 'sql'),
    ])

    for (const html of results) expect(html).toContain('<span style="color:')
  })
})
