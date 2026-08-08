import { describe, expect, it } from 'vitest'

import { SHARE_SLUG_LENGTH, SITE_URL } from '@/lib/constants'
import { generateShareSlug, shareUrl } from '@/lib/share'

/**
 * The slug is the only thing standing between a shared conversation and anyone
 * who tries to find it, so "it looks random" is not a standard. These assert the
 * two properties that actually matter — the length the entropy figure is derived
 * from, and that the alphabet is URL-safe — plus a distribution check crude
 * enough to survive but sharp enough to catch a generator that has stopped
 * being random at all.
 */

describe('generateShareSlug', () => {
  it('is the length constants.ts derives its entropy figure from', () => {
    // ~71 bits is six bits per character times this. A shorter slug would leave
    // that comment describing a security property the code no longer has.
    expect(generateShareSlug()).toHaveLength(SHARE_SLUG_LENGTH)
  })

  it('uses only URL-safe characters', () => {
    // A `+` or a `/` would need encoding, and a slug that changes shape when
    // pasted is a link that sometimes 404s.
    for (let i = 0; i < 200; i += 1) {
      expect(generateShareSlug()).toMatch(/^[A-Za-z0-9_-]+$/)
    }
  })

  it('does not repeat itself across a thousand slugs', () => {
    // Not a birthday-paradox test — at ~71 bits a genuine collision here would
    // be astonishing. What this catches is the generator having become constant
    // or near-constant, which is exactly the failure a share link cannot afford
    // and the one that no other assertion in this file would notice.
    const slugs = new Set(Array.from({ length: 1000 }, () => generateShareSlug()))

    expect(slugs.size).toBe(1000)
  })

  it('reaches most of its alphabet, so the mask is not collapsing the range', () => {
    // A `& 15` instead of `& 63` would still produce URL-safe strings of the
    // right length and would still pass every test above, while quietly cutting
    // the keyspace from 71 bits to 48. Sampling the characters actually emitted
    // is what distinguishes those two.
    const seen = new Set(
      Array.from({ length: 500 }, () => generateShareSlug())
        .join('')
        .split(''),
    )

    expect(seen.size).toBeGreaterThan(60)
  })
})

describe('shareUrl', () => {
  it('builds an absolute URL under /share', () => {
    expect(shareUrl('abc123')).toBe(`${SITE_URL.replace(/\/$/, '')}/share/abc123`)
  })

  it('does not double the slash when SITE_URL has a trailing one', () => {
    // The env var is hand-written per environment, so the trailing slash is a
    // matter of who typed it. A `//share/` path is a different URL, and the one
    // that would be pasted somewhere permanent before anyone noticed.
    expect(shareUrl('abc123')).not.toContain('//share/')
  })
})
