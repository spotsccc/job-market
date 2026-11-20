import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  // Входящие запросы пишет наш логгер (src/request-logging.ts), встроенный лог Next дублировал бы их.
  logging: { incomingRequests: false },
  experimental: { optimizePackageImports: ['@mantine/core', '@mantine/hooks'] },
  transpilePackages: [
    '@job-market/channel-linkedin',
    '@job-market/core',
    '@job-market/db',
    '@job-market/logger',
  ],
};

export default nextConfig;
