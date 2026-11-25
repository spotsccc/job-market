# Схема `monitoring`

Представления, которые читает Grafana с дашбордом «Движок» (`packages/dashboards`,
`docs/plans/monitoring.html`). Своих данных у схемы нет: представления считаются из таблиц движка
при каждом запросе. Роль `grafana` на Neon видит только эту схему (П11 плана), поэтому в
представлениях нет текстов публикаций.

| Представление        | Одна строка                                                                                                |
| -------------------- | ---------------------------------------------------------------------------------------------------------- |
| `monitoring.events`  | событие движка: `at`, `kind`, `source_id`, `source`, `platform`, `connector`, `detail`                     |
| `monitoring.sources` | источник для переменных дашборда «Площадка» и «Источник»: `id`, `name`, `platform`, `connector`, `enabled` |

## Что считает каждый `kind`

| `kind`              | Строка                                     | `at`                    | `detail`             | Правило |
| ------------------- | ------------------------------------------ | ----------------------- | -------------------- | ------- |
| `publication`       | `publications`                             | `created_at`            | —                    | П1      |
| `vacancy`           | `vacancies`                                | `created_at` вакансии   | —                    | П2      |
| `parse_error`       | `source_runs` со `status = 'failed'`       | `finished_at`           | `error`              | П3      |
| `link_error`        | `publication_links` со `status = 'failed'` | `created_at` публикации | `host`               | П4      |
| `duplicate`         | `publications` со `status = 'duplicate'`   | `processed_at`          | —                    | П5      |
| `not_vacancy`       | `publications` со `status = 'not_vacancy'` | `processed_at`          | `not_vacancy_reason` | П6      |
| `extraction_error`  | `publications` со `status = 'failed'`      | `processed_at`          | `last_error`         | П7      |
| `vacancy_duplicate` | `vacancy_duplicates`                       | `created_at`            | `title`              | П14     |

- Источник события — источник публикации (`publications.source_id`, тот, что нашёл её первым) или
  строки истории опросов. Площадка и имя — у источника на момент запроса: переименованный
  источник показывается с новым именем за все дни (П8).
- Публикации `pending` и `processing` в разборе не считаются, даже если попытки уже были;
  публикация, которую потом разобрали, уходит из `extraction_error` (П7). Проходы `done` и
  `more` — не ошибки; `failed` — ошибка, даже если проход успел записать публикации (П3).
  Ссылки `no_data`, `unsupported` и `over_limit` — не ошибки (П4).

## Что поменять

- **Новый статус публикации или новый вид события** — ветка `UNION ALL` в `events`
  (`monitoring.ts`), строка в таблице выше, случай в `monitoring.test.ts` и панель в
  `packages/dashboards/src/engine.ts`. Затем `pnpm db:generate`: drizzle-kit пересоздаёт
  представление (`DROP VIEW` и `CREATE VIEW`). Права роли `grafana` на новое представление даёт
  `ALTER DEFAULT PRIVILEGES` из раздела «Мониторинг» корневого README.
- **Новый столбец в представлении** — тоже: Grafana видит только то, что есть в представлении.
