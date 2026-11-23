# job-market

Сбор вакансий из открытых источников (начиная с LinkedIn) для анализа рынка и быстрого поиска подходящих позиций под конкретный профиль.

Статус: проектирование; каркас монорепы готов, кода приложения пока нет.

- [Пользовательский флоу](docs/01-user-flow.md) — что я рассказываю о себе, как задаю поиск и разбираю результаты.
- [Моки экранов](docs/mockups/README.md) — онбординг, Inbox, База, Профиль.
- [План реализации](docs/plans/linkedin-jobs-v1.html) — сценарии, архитектура (C4, UML), модель данных, правила, эджкейсы, риски и открытые вопросы, этапы. Открывать в браузере.
- [Спайк поиска](scripts/spike-search.mjs) — `node scripts/spike-search.mjs` с домашнего IP: 8 вариантов поиска (frontend, remote, Аргентина / LATAM / Worldwide / US) и отчёт `spike-out/report.md`, какие из найденных вакансий можно взять из Аргентины.

## Разработка

Монорепа на Turborepo и pnpm-воркспейсах, Node 24+ (версия в `.node-version`).

```bash
pnpm install
pnpm dev            # apps/web на http://localhost:3000
pnpm check          # turbo run format:check lint check-types
```

| Пакет | Что это |
| --- | --- |
| `apps/web` | Next.js 16 (App Router, `src/app`) |
| `packages/core` | значения полей поста и вакансии, общие для схемы ответа модели и базы |
| `packages/channel-linkedin` | поиск постов LinkedIn через актор Apify |
| `packages/channel-telegram` | чтение публичных Telegram-каналов через веб-превью `t.me/s/<канал>` |
| `packages/errors` | общие ошибки на `@spotsccc/error-as-value`: базовая `AppError` (`extendable: true`), остальные — `createTaggedError({ ..., extends: AppError })` |
| `packages/typescript-config` | общие tsconfig: `base.json`, `node.json`, `nextjs.json` |
| `packages/oxlint-config` | общие конфиги oxlint: `base.json`, `next.json` (+ react, jsx-a11y, nextjs) |
| `packages/oxfmt-config` | общий конфиг oxfmt: `baseConfig` |

Линт, типы и форматирование работают по пакетам через turbo, у каждого пакета свои конфиги, наследующие общие:

- `pnpm lint` / `pnpm lint:fix` — oxlint. `.oxlintrc.json` пакета подключает `@job-market/oxlint-config` через `extends`. Type-aware правила (oxlint-tsgolint); correctness, suspicious, pedantic, perf — ошибки; предупреждения тоже валят прогон.
- `pnpm check-types` — `tsc --noEmit` (TypeScript 7); в web перед этим `next typegen`.
- `pnpm format` / `pnpm format:check` — oxfmt. `oxfmt.config.ts` пакета реэкспортирует `baseConfig` из `@job-market/oxfmt-config`; свои настройки — `{ ...baseConfig, ... }`.
- Файлы вне пакетов (README, docs, корневые json) не форматируются и не линтятся.
- Конфиг-пакеты ссылаются друг на друга относительными путями (`../oxlint-config/base.json`), а не зависимостями — иначе цикл в графе turbo.
- Новый пакет: `tsconfig.json`, `.oxlintrc.json`, `oxfmt.config.ts` по образцу `packages/core`, скрипты `check-types`, `lint`, `format`, `format:check`.
