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

## Сбор Telegram-каналов

Каналы-агрегаторы вакансий geekjobs (список — `apps/web/src/telegram/channels.ts`) собираются раз в день на Vercel:

- **Расписание** — `crons` в `apps/web/vercel.json`, 05:00 UTC (на Hobby — ±59 минут). Vercel Cron зовёт `GET /api/cron/telegram` с `Authorization: Bearer $CRON_SECRET`.
- **Сбор** (`src/telegram/crawl.ts`) листает превью каждого канала от новых сообщений вниз, пока не встретит уже собранное. Первый проход берёт всё за 30 дней. Все сообщения, включая не вакансии, ложатся в `telegram_messages`, курсор канала — в `telegram_channels`. Прерванный проход доделывается со следующего запуска без дыр.
- **Разбор** (`src/telegram/process-queue.ts`) берёт сообщения из очереди и прогоняет их через те же модели, что и посты LinkedIn. Вакансии пишутся в общие `posts`/`vacancies`. Одну вакансию каналы публикуют дословно в нескольких каналах: разбирается одна копия, остальные помечаются `duplicate`. Упавшее сообщение повторяется не раньше чем через 5 минут, не больше 3 раз.
- **Цепочка вызовов.** Функция живёт до `maxDuration` (300 секунд). Если работа осталась, звено зовёт следующее тем же роутом с `?hop=N`. Первый сбор (~5 тысяч сообщений) растягивается на несколько звеньев, ежедневный укладывается в одно-два. Предел — 40 звеньев.

Чтобы это работало на Vercel:

1. Задать `CRON_SECRET` в переменных окружения проекта.
2. Проверить, что в Project Settings → Functions включён Fluid compute: без него на Hobby функция живёт 60 секунд, а не 300, и расчёт времени звена не сходится.
3. Не включать Deployment Protection для production-домена: продолжение цепочки зовёт роут по тому же адресу, защита ответит 401, и цепочка остановится (в логах — `Continuation returned HTTP 401`).

`?channels=` ограничивает только сбор: разбор берёт всю очередь `telegram_messages`. На пустой очереди это проверка на одном канале (разбор вызовет настоящие модели, нужен `AI_GATEWAY_API_KEY`):

```bash
curl -H "Authorization: Bearer $CRON_SECRET" "localhost:3000/api/cron/telegram?channels=forproducer"
```
