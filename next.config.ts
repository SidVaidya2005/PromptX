import path from 'node:path'

import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  turbopack: {
    // Pin the workspace root. Without this Next walks upward looking for a
    // lockfile and can settle on a directory above the repo, which silently
    // changes what gets file-traced into the production output.
    root: path.resolve(import.meta.dirname),
  },
  images: {
    // Google profile photos, the only remote images in the product. Every
    // next/image in this codebase also carries `unoptimized` — Render runs the
    // optimizer inside the same single process that serves streams, and its
    // disk cache does not survive a redeploy.
    remotePatterns: [
      { protocol: 'https', hostname: 'lh3.googleusercontent.com', pathname: '/**' },
    ],
  },
  /**
   * The other half of "a revoked share link stops working immediately". (F33)
   *
   * `/share/[slug]/page.tsx` exports `dynamic = 'force-dynamic'`, which stops
   * Next from generating or revalidating a copy. That says nothing to anything
   * *downstream* — a CDN or a browser is free to keep serving what it was handed
   * — and revocation is exactly the case where a cached copy defeats the whole
   * mechanism. Both are required; neither substitutes for the other.
   *
   * `private` as well as `no-store`, belt and braces: the first forbids a shared
   * cache from holding it at all, the second forbids any cache from storing it.
   */
  async headers() {
    return [
      {
        source: '/share/:slug*',
        headers: [{ key: 'Cache-Control', value: 'private, no-store' }],
      },
    ]
  },
}

export default nextConfig
