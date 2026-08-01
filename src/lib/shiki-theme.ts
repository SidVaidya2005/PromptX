import type { ThemeRegistration } from 'shiki/types'

/**
 * The syntax theme, built from DESIGN.md's neutrals and nothing else.
 *
 * DESIGN.md is explicit that a stock theme "reintroduces chromatic accents the
 * system does not use" — this product has no brand hue, and `danger`, `warn`
 * and `success` are reserved for state. That leaves lightness and italics as
 * the only two axes available for separating one token from another, so the
 * ladder below is deliberately short: four steps, used consistently.
 *
 *   ink          #f7f5f0  the brightest thing in a block — keywords and tags,
 *                         the words that carry the structure
 *   body-strong  #dad2c1  the default: identifiers, operators, punctuation
 *   body         #c9c0ad  values — strings, numbers, constants
 *   mute         #aea69c  comments, italic, quietest by design
 *
 * Anything not named by a scope below inherits `fg`, which is why the settings
 * list stays this short. A longer list would not add information; it would add
 * near-identical greys that read as noise.
 *
 * `bg` is transparent on purpose. The `code-block` chrome owns the fill
 * (`canvas-soft`), so a background here would paint a second, slightly
 * different rectangle inside the first.
 */
export const PROMPTX_THEME_NAME = 'promptx'

export const promptxTheme: ThemeRegistration = {
  name: PROMPTX_THEME_NAME,
  type: 'dark',
  fg: '#dad2c1',
  bg: 'transparent',
  settings: [
    {
      scope: ['comment', 'punctuation.definition.comment'],
      settings: { foreground: '#aea69c', fontStyle: 'italic' },
    },
    {
      scope: [
        'string',
        'string.quoted',
        'string.template',
        'constant.numeric',
        'constant.language',
        'constant.character',
        'punctuation.definition.string',
      ],
      settings: { foreground: '#c9c0ad' },
    },
    {
      scope: [
        'keyword',
        'keyword.control',
        'keyword.operator.new',
        'keyword.operator.expression',
        'storage',
        'storage.type',
        'storage.modifier',
        'entity.name.tag',
        'support.type.property-name',
        'variable.language',
      ],
      settings: { foreground: '#f7f5f0' },
    },
    {
      // Punctuation and operators recede. They are structure the eye already
      // knows how to skip, and dropping them a step makes the names between
      // them easier to pick out.
      scope: ['punctuation', 'meta.brace', 'keyword.operator'],
      settings: { foreground: '#aea69c' },
    },
  ],
}
