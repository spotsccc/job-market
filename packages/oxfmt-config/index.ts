import { defineConfig } from 'oxfmt';

export const baseConfig = defineConfig({
  printWidth: 100,
  singleQuote: true,
  trailingComma: 'all',
  sortImports: {},
  sortPackageJson: true,
  ignorePatterns: ['node_modules/', 'dist/', '.next/', '.turbo/', 'next-env.d.ts'],
});
