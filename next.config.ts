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
}

export default nextConfig
