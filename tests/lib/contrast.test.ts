import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Every text token against every surface it is drawn on, at WCAG AA. (F37)
 *
 * This is a unit test rather than part of the axe sweep, and the split is the
 * point. Axe measures contrast for text **currently on screen**, so a token used
 * only in a state the audit did not reach — an error message, a disabled
 * control, a warning that needs a tripped breaker to appear — is invisible to
 * it. Reading the tokens out of `globals.css` and computing the ratios covers
 * every one of them, including combinations no route happens to render today.
 *
 * The values are parsed from the stylesheet rather than duplicated here. A
 * second copy of a colour is a second thing to update, and the one that gets
 * forgotten is the one in the test that is supposed to be guarding it.
 *
 * AA is 4.5:1 for body text and 3:1 for large text. Everything below is treated
 * as body text — the stricter bar — except where a token is only ever used
 * large, and there is currently nothing in that category.
 */

const CSS = readFileSync(path.join(process.cwd(), 'src', 'app', 'globals.css'), 'utf8')

function token(name: string): string {
  const match = CSS.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`))
  if (!match?.[1]) throw new Error(`--color-${name} not found in globals.css`)
  return match[1]
}

/** WCAG relative luminance. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })

  const [r, g, b] = channels as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function ratio(foreground: string, background: string): number {
  const a = luminance(foreground)
  const b = luminance(background)
  const [lighter, darker] = a > b ? [a, b] : [b, a]
  return (lighter + 0.05) / (darker + 0.05)
}

/** The two surfaces text is ever drawn on. Elevation here is surface contrast. */
const SURFACES = ['canvas', 'canvas-soft'] as const

/**
 * Every token that carries text.
 *
 * `mute` is included deliberately even though `code-standards.md` restricts it
 * to timestamps and fine print: "the lightest text permitted" is a claim that
 * has to hold, and it is the token most likely to fail.
 */
const TEXT_TOKENS = [
  'ink',
  'body-strong',
  'body',
  'mute',
  'primary',
  'danger',
  'warn',
  'success',
] as const

describe('text contrast against every surface', () => {
  for (const surface of SURFACES) {
    for (const name of TEXT_TOKENS) {
      it(`${name} on ${surface} clears WCAG AA`, () => {
        const value = ratio(token(name), token(surface))

        // Reported to two decimals in the failure message, so a near miss is
        // actionable rather than just red.
        expect(
          Number(value.toFixed(2)),
          `--color-${name} on --color-${surface}`,
        ).toBeGreaterThanOrEqual(4.5)
      })
    }
  }

  it('on-primary clears AA against the primary fill it sits on', () => {
    // The one inverted pair: dark text on the off-white button.
    expect(
      Number(ratio(token('on-primary'), token('primary')).toFixed(2)),
    ).toBeGreaterThanOrEqual(4.5)
  })

  it('reads real values, so a renamed token fails loudly rather than silently', () => {
    // Without this the regex could quietly stop matching and every ratio above
    // would be computed from a default nobody chose.
    expect(token('canvas')).toMatch(/^#[0-9a-f]{6}$/i)
    expect(() => token('does-not-exist')).toThrow(/not found/)
  })
})
