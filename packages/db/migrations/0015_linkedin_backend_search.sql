-- Поиск постов LinkedIn о вакансиях бэкенда: четыре запроса, по 50 самых новых постов за сутки
-- на каждый. Источник опрашивается раз в сутки (interval_minutes по умолчанию 1440), поэтому
-- postedLimit — 24h. Config проходит configSchema коннектора linkedin.
UPDATE "sources" SET
  "config" = '{
    "queries": [
      "hiring backend developer",
      "hiring backend engineer remote",
      "we are hiring backend",
      "looking for backend developer"
    ],
    "maxPosts": 50,
    "postedLimit": "24h",
    "sortBy": "date"
  }'::jsonb,
  "enabled" = true
WHERE "connector" = 'linkedin' AND "key" = 'manual';
