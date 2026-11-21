import { baseConfig } from '@job-market/oxfmt-config';
import { defineConfig } from 'oxfmt';

export default defineConfig({
  ...baseConfig,
  // Фикстуры — настоящие страницы t.me как есть: форматирование меняет разметку, которую разбираем.
  ignorePatterns: [...baseConfig.ignorePatterns, 'fixtures/'],
});
