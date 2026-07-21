import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Workspace packages ship TypeScript source; Next transpiles them.
  transpilePackages: ['@divzy/shared', '@divzy/api-client'],
  output: 'standalone',
  // Separate build output from `next dev`'s `.next` so running a production
  // build/start alongside the dev server never overwrites its dev-mode
  // compiler state (this corrupted the running dev server once already).
  distDir: process.env.NODE_ENV === 'production' ? '.next-prod' : '.next',
  // Dev server is reached via the host's LAN/public IP, not just localhost.
  allowedDevOrigins: ['79.72.92.105', '10.0.0.116'],
  images: {
    remotePatterns: [
      { protocol: 'http', hostname: 'localhost' },
      { protocol: 'https', hostname: '**' },
    ],
  },
};

export default nextConfig;
