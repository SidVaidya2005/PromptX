import path from 'node:path'

import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  turbopack: {
    // Pin the workspace root. Without this Next walks upward looking for a
    // lockfile and can settle on a directory above the repo, which silently
    // changes what gets file-traced into the production output.
    root: path.resolve(import.meta.dirname),
  },
}

export default nextConfig
