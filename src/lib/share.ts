/**
 * Share slugs and the URLs built from them. (F33)
 *
 * Pure, so the node-environment suite can reach both — a slug generator with no
 * test is a thing nobody notices has stopped being random.
 */

import { SHARE_SLUG_LENGTH, SITE_URL } from '@/lib/constants'

/**
 * The alphabet, and its size is doing real work.
 *
 * **64 characters, which divides 256 evenly.** That is what makes masking the
 * low six bits of a random byte unbiased and lets this skip rejection sampling
 * entirely: every character is reachable by exactly four of the 256 byte values.
 * At 63 or 65 the naive `% length` would favour the front of the alphabet, which
 * is the classic way a slug generator quietly loses entropy — and losing it here
 * narrows the space someone has to guess to reach a stranger's conversation.
 *
 * Six bits per character × `SHARE_SLUG_LENGTH` is the ~71 bits `constants.ts`
 * documents.
 *
 * URL-safe by construction: `-` and `_` complete the set rather than `+` and
 * `/`, so a slug never needs encoding and never picks up a `%` in a pasted link.
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

/**
 * An unguessable slug for a public link.
 *
 * `crypto.getRandomValues` rather than `Math.random`, which is not a
 * cryptographic source and would make these enumerable — the URL is the only
 * thing standing between a conversation and the internet, so the requirement is
 * the same one a session token has.
 *
 * Deliberately **not** `nanoid`, which `build-plan.md` §33 named. It is not a
 * dependency of this project and adding one for a single function is the trade
 * `code-standards.md`'s dependency gate exists to make deliberate. Web Crypto is
 * a global in Node 26, so this needs no import at all — which also keeps it
 * clear of the invariant naming `src/server/vault.ts` as the module that imports
 * `node:crypto`.
 */
export function generateShareSlug(): string {
  const bytes = new Uint8Array(SHARE_SLUG_LENGTH)
  crypto.getRandomValues(bytes)

  let slug = ''
  for (const byte of bytes) {
    // Mask, never modulo. `% 64` would be identical here because the alphabet is
    // a power of two, and would silently become biased the moment somebody
    // changed its length — the mask breaks loudly instead.
    slug += ALPHABET[byte & 63]
  }

  return slug
}

/**
 * The full public URL for a slug.
 *
 * Built from `SITE_URL` rather than from the request's own origin, for the
 * reason that constant records: Render terminates TLS at a proxy, so an origin
 * read off the request can be the internal address. A share link is copied and
 * pasted somewhere permanent, which makes it the worst possible place to
 * discover that.
 */
export function shareUrl(slug: string): string {
  return `${SITE_URL.replace(/\/$/, '')}/share/${slug}`
}
