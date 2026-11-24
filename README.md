# job-market

Сбор вакансий из открытых источников (начиная с LinkedIn) для анализа рынка и быстрого поиска подходящих позиций под конкретный профиль.

Статус: проектирование; каркас монорепы готов, кода приложения пока нет.

- [Пользовательский флоу](docs/01-user-flow.md) — что я рассказываю о себе, как задаю поиск и разбираю результаты.
- [Моки экранов](docs/mockups/README.md) — онбординг, Inbox, База, Профиль.
- [Планы реализации](docs/plans/) — по файлу на фичу: сценарии, архитектура (C4, UML), модель данных, правила, эджкейсы, риски и открытые вопросы, этапы. Открывать в браузере.
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
| `packages/engine` | движок опроса: обработчик задания «опроси источник» — раздел «Движок» ниже |
| `packages/connectors` | коннекторы источников: `drain` выкачивает публикации в базу, `mine` добывает из публикации вакансии — раздел «Коннекторы» ниже |
| `packages/apify` | клиент Apify: запуск акторов, ожидание запуска и чтение датасета |
| `packages/enricher` | дочитывает ссылки LinkedIn в тексте публикации |
| `packages/classifier` | вакансия ли публикация, и если нет — почему — [README](packages/classifier/README.md) |
| `packages/extractor` | роли вакансии из текста публикации: профессия, места, навыки, условия — [README](packages/extractor/README.md) |
| `packages/db` | схема и запросы; запись публикаций и вакансий — [README](packages/db/src/publication/README.md), компании — [README](packages/db/src/company/README.md) |
| `packages/geo` | гео-справочник: страны, регионы найма и города из GeoNames; разбор и поиск мест — [README](packages/geo/README.md) |
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
- Новый пакет: `tsconfig.json`, `.oxlintrc.json`, `oxfmt.config.ts` по образцу `packages/logger`, скрипты `check-types`, `lint`, `format`, `format:check`.

## Коннекторы

`packages/connectors` — код, который читает источники вакансий и разбирает их публикации. План — [docs/plans/connectors.html](docs/plans/connectors.html). Коннектора два: `open-telegram` — публичные каналы через `t.me/s/<канал>`, `linkedin` — поиск постов через актор Apify.

Снаружи у коннектора два метода: `drain` зовёт движок (раздел «Движок»), `mine` — пока только тесты:

- `drain(source, { now, deadline })` — выкачивает новые публикации источника, дочитывает в них ссылки LinkedIn и одной транзакцией пишет авторов, публикации, их ссылки (`publication_links`) и курсор `sources.cursor`. Расписание источника (`next_run_at`, ошибки подряд) не трогает. Итог — `done`, `more` или `failed`; `Error` — только сбой базы.
- `mine(publication)` — разбирает публикацию в `pending` или `processing` классификатором и экстрактором, сводит места ролей к гео-справочнику и одной транзакцией пишет вакансии и итог разбора. Итог — `vacancy`, `not_vacancy` или `skipped`; `Error` — сбой модели, справочника или базы, статус публикации прежний.

Коннекторы берёт реестр `createConnectors({ telegram, linkedin, models, readers })`: каналы сервисов (`createTelegramChannel`, `createLinkedinChannel`), модели и читатели енричера (`createReaders`) приходят снаружи, тесты подставляют фейки. Для тестов вызывающих `@job-market/connectors/test-utils` даёт `fakeTelegram` и `testConnector`.

Внутри коннектор — каталог `src/<коннектор>` и определение `ConnectorDefinition`:

- `configSchema` и `cursorSchema` — zod-схемы `sources.config` и `sources.cursor`. Курсор, который не проходит схему, — первый опрос на `DEPTH_DAYS` = 30 дней.
- `parse({ config, cursor, key, since, deadline })` — читает сервис без базы и отвечает публикациями, курсором и `more`. После `deadline` новый запрос не начинает; сбой посреди прохода возвращает прочитанное и `error`.
- `process(publication, { occupations })` — разбирает публикацию моделями без базы. Коннекторы с обычными постами берут общий `classifyAndExtract`.

Новый коннектор: id в `CONNECTORS` (`packages/db/src/publication/values.ts`) и метка в `CONNECTOR_LABELS` (`packages/publication-text`), каталог с `parse` и схемами, строка в `createConnectors`. `drain` и `mine` писать не нужно — они общие.

Тесты `drain` и `mine` идут в тестовую базу: `pnpm db:up && pnpm db:migrate:test`, затем `pnpm --filter @job-market/connectors test`.

## Движок

`packages/engine` — движок опроса источников. План — [docs/plans/drain-source-job.html](docs/plans/drain-source-job.html). Пока в нём один обработчик; tick, который раздаёт задания по расписанию, добавит план [docs/plans/engine.html](docs/plans/engine.html), а очередь Vercel Queues и её потребителя — план подключения очереди.

`handleDrainSourceJob({ sourceId, connectors, queue, now, deadline })` — обработчик задания «опроси источник» из очереди; вызов может прийти повторно. Он читает источник заново, зовёт `drain` его коннектора из реестра `createConnectors`, пишет расписание источника и при необходимости кладёт продолжение в очередь. Итог — `done`, `requeued`, `failed` или `skipped` (источника нет, он выключен или его коннектора нет в реестре) и `inserted` из `drain`. `Error` — сбой базы или отправки продолжения: такое задание повторяет очередь. Сбой сервиса — `failed`, а не `Error`: у него своя пауза.

Публикации и курсор пишет `drain`, расписание решает движок, а пишет `@job-market/db`: чистая `scheduleAfterDrain(source, result, now)` переводит итог `drain` в поля источника, `updateSourceSchedule(db, id, schedule)` пишет их и ничего не решает. Отдельной транзакцией после `drain`:

- `done` — `consecutive_failures` = 0, `last_error` = NULL, `last_success_at` = now; `next_run_at` уже сдвинул tick.
- `failed` — `consecutive_failures` + 1, `last_error` — текст ошибки, `next_run_at` = now + min(`interval_minutes` · 2^ошибок, 24 ч). Источник не выключается, продолжения нет.
- `more` — проход не закончен: пишется только `last_fetched_at`, а в очередь идёт продолжение через 60 с с ключом `sourceId:sha256(курсора)` — повтор того же продолжения очередь отбросит.

`last_fetched_at` = now пишется при любом итоге. Очередь — интерфейс `JobQueue` (`enqueue(jobs)` → `Error` или ничего); в тестах движка — `memoryJobQueue({ failOnBatch? })` из `src/memory-job-queue.test-utils.ts`.

Тесты: `schedule.test` проверяет ветки расписания без базы, `drain-source-job.test` — связку на тестовой базе с `open-telegram` на поддельном t.me: `pnpm db:up && pnpm db:migrate:test`, затем `pnpm --filter @job-market/engine test`.

## Перенос постов в новую модель

Посты `legacy_posts` переносятся в новую модель (`publications`, `authors`, `vacancies`, `vacancy_locations`) через новый экстрактор `@job-market/extractor` — [README переноса](apps/web/src/transfer/README.md), [README экстрактора](packages/extractor/README.md). Скрипт идёт с машины владельца: перенос дольше, чем живёт функция Vercel.

Нужны `DATABASE_URL`, `AI_GATEWAY_API_KEY` и `APIFY_TOKEN` (читатели ссылок LinkedIn). Без `NODE_ENV` переменные берутся из `apps/web/.env.local`, с `NODE_ENV=production` — только из окружения, как у `pnpm db:migrate`. Перед переносом на проде — снимок базы.

```bash
# пробный запуск — модель вызывается, но каждая транзакция откатывается
NODE_ENV=production DATABASE_URL=… AI_GATEWAY_API_KEY=… APIFY_TOKEN=… pnpm --filter @job-market/web vacancies:transfer --dry-run --limit 20
# сотня постов
NODE_ENV=production … pnpm --filter @job-market/web vacancies:transfer --limit 100
# все оставшиеся; повторный запуск печатает «Постов 0»
NODE_ENV=production … pnpm --filter @job-market/web vacancies:transfer
```

Первая строка вывода — хост базы и сколько постов ещё без публикации: сверьте их до продолжения. Итог запуска:

- **Постов** — взято в запуск; **вакансий** — записано ролей; **копий** — постов с тем же текстом, что уже разобранный (`duplicate`, модель не зовётся); **без текста** — пост пустой (`not_vacancy`, модель не зовётся).
- **Ошибок** — пост записан `failed` с `last_error`: упала модель, экстрактор не нашёл ролей, упал справочник или чтение ссылки. Пост без ролей после трёх попыток — ошибка старого классификатора. Следующий запуск пробует его снова, пока попыток меньше трёх. Строки ошибок идут ниже.
- **Уже перенесено** — публикацию записал другой запуск в это же время; **копий ждут оригинал** — оригинал упал в этом запуске, копии запишутся следующим.
- **Ссылки**, **Профессии**, **Места** — сколько ссылок прочитано и сколько сбоев, вакансии по узлам дерева профессий, итоги сведения мест к гео-справочнику.
- **Сверка** (кроме пробного) — `legacy_posts` против `publications` по статусам, постов без публикации, вакансии по версии схемы и посты `failed` после трёх попыток.

Если в пачке упали все вызовы модели (кончились кредиты, 429), запуск останавливается с «Запуск остановлен: все вызовы модели упали».

### Набор проверки экстрактора

30 размеченных постов в `packages/extractor/eval/cases` и снимок дерева профессий `eval/occupations.json`. Прогон зовёт настоящую модель (около 30 вызовов) и сводит места к справочнику локальной базы, поэтому в `pnpm test` не входит:

```bash
pnpm --filter @job-market/extractor eval
pnpm --filter @job-market/extractor eval --case geekjobs-10533
pnpm --filter @job-market/extractor eval --compare eval/reports/<отчёт>.json
```

Печатает долю совпадений по каждому полю, точность и полноту списков, расхождения по случаям и пишет отчёт в `packages/extractor/eval/reports/`. Модель отвечает по-разному на один текст: правка промпта — улучшение, только если поле выросло больше, чем разница двух прогонов без правок.

### Набор проверки классификатора

20 размеченных публикаций в `packages/classifier/eval/cases`: 8 вакансий и по 4 на каждую причину «не вакансия» — `job_seeker`, `no_specific_role`, `not_hiring` ([README](packages/classifier/README.md)). Прогон зовёт настоящую модель (20 вызовов), поэтому в `pnpm test` не входит:

```bash
pnpm --filter @job-market/classifier eval
```

Печатает долю совпавших вердиктов, совпадения по каждому вердикту и несовпадения «ждали → получили» с id случаев. Отчёт пишет в `packages/classifier/eval/reports/`.
