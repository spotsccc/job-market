import { baseConfig } from '@job-market/oxfmt-config';
import { defineConfig } from 'oxfmt';

// migrations/ пишет drizzle-kit: формат его, иначе каждая генерация спорила бы с format:check.
export default defineConfig({
  ...baseConfig,
  ignorePatterns: [...baseConfig.ignorePatterns, 'migrations/'],
});
