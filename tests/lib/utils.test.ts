import { describe, expect, it } from 'vitest'

import { safeRedirectPath } from '@/lib/utils'

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
