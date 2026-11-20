import { defineConfig } from 'drizzle-kit';

/**
 * Генерация миграций: `pnpm db:generate` сравнивает схему из `src/schema.ts` (все домены) со
 * снимком в `migrations/meta` и пишет новый SQL-файл. Базе не подключается —
 * применяет миграции `pnpm db:migrate`.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './migrations',
  casing: 'snake_case',
  strict: true,
  verbose: true,
});
