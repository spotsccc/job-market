-- Запуск движка: включаем Telegram-каналы GeekJobs, которые миграция 0010 создала выключенными.
-- next_run_at у них в прошлом, поэтому первый tick после деплоя возьмёт их все и разнесёт
-- опросы по 10 минутам (spreadDelay). linkedin/manual остаётся выключенным: у него пустой
-- config, а коннектору нужны queries и maxPosts.
UPDATE "sources" SET "enabled" = true WHERE "connector" = 'open-telegram' AND NOT "enabled";
