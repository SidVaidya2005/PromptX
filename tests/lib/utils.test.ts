import { describe, expect, it } from 'vitest'

import { initialOf, resolveDisplayName, safeRedirectPath } from '@/lib/utils'

/**
 * safeRedirectPath guards /auth/callback, which redirects while handing over a
 * newly issued session. An open redirect there does not just send someone
 * somewhere unexpected — it delivers them to an attacker's page as a
 * freshly signed-in user.
 */
describe('safeRedirectPath', () => {
  it('keeps an ordinary same-site path', () => {
    expect(safeRedirectPath('/chat', '/fallback')).toBe('/chat')
    expect(safeRedirectPath('/settings/keys?tab=openai', '/fallback')).toBe(
      '/settings/keys?tab=openai',
    )
  })

  it('falls back when nothing was supplied', () => {
    expect(safeRedirectPath(null, '/chat')).toBe('/chat')
    expect(safeRedirectPath(undefined, '/chat')).toBe('/chat')
    expect(safeRedirectPath('', '/chat')).toBe('/chat')
  })

  it('refuses a protocol-relative URL disguised as a path', () => {
    // The one a bare startsWith('/') check waves through.
    expect(safeRedirectPath('//evil.example', '/chat')).toBe('/chat')
    expect(safeRedirectPath('/\\evil.example', '/chat')).toBe('/chat')
  })

  it('refuses an absolute URL', () => {
    expect(safeRedirectPath('https://evil.example/steal', '/chat')).toBe('/chat')
    expect(safeRedirectPath('javascript:alert(1)', '/chat')).toBe('/chat')
  })
})

/**
 * The sidebar footer is 260px wide and shows one line. Both of these decide
 * what a person sees there when the profile row is incomplete — which is an
 * ordinary state, since display_name is nullable and editable.
 */
describe('resolveDisplayName', () => {
  it('prefers the name the person set', () => {
    expect(resolveDisplayName('Sid Vaidya', 'sid@example.com')).toBe('Sid Vaidya')
  })

  it('falls back to the local part rather than the whole address', () => {
    // The full address truncates to nothing recognisable at this width.
    expect(resolveDisplayName(null, 'sid@example.com')).toBe('sid')
    expect(resolveDisplayName(undefined, 'sid@example.com')).toBe('sid')
  })

  it('treats a blank name as no name', () => {
    expect(resolveDisplayName('', 'sid@example.com')).toBe('sid')
    expect(resolveDisplayName('   ', 'sid@example.com')).toBe('sid')
  })

  it('trims a name that was saved with surrounding space', () => {
    expect(resolveDisplayName('  Sid  ', 'sid@example.com')).toBe('Sid')
  })

  it('survives an address with no local part', () => {
    expect(resolveDisplayName(null, '@example.com')).toBe('@example.com')
    expect(resolveDisplayName(null, '')).toBe('')
  })
})

describe('initialOf', () => {
  it('uses the first character, upper-cased', () => {
    expect(initialOf('Sid Vaidya')).toBe('S')
    expect(initialOf('sid')).toBe('S')
  })

  it('ignores leading whitespace', () => {
    expect(initialOf('  sid')).toBe('S')
  })

  it('keeps an astral-plane character whole', () => {
    // charAt(0) would return half a surrogate pair, which renders as a
    // replacement glyph rather than the character.
    expect(initialOf('😀 Sid')).toBe('😀')
    expect(initialOf('𝒮id')).toBe('𝒮')
  })

  it('falls back to a placeholder rather than rendering nothing', () => {
    expect(initialOf('')).toBe('?')
    expect(initialOf('   ')).toBe('?')
  })
})
