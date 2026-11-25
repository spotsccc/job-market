import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  // Входящие запросы пишет наш логгер (src/request-logging.ts), встроенный лог Next дублировал бы их.
  logging: { incomingRequests: false },
  experimental: { optimizePackageImports: ['@mantine/core', '@mantine/hooks'] },
  transpilePackages: [
    '@job-market/apify',
    '@job-market/classifier',
    '@job-market/connectors',
    '@job-market/db',
    '@job-market/engine',
    '@job-market/enricher',
    '@job-market/errors',
    '@job-market/extractor',
    '@job-market/geo',
    '@job-market/http-client',
    '@job-market/logger',
    '@job-market/publication-text',
  ],
};

export default nextConfig;
