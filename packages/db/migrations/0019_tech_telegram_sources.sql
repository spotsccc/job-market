-- Технические Telegram-каналы GeekJobs: QA, DevOps, Frontend и Node.js, Mobile, Python, JVM,
-- C/C++, C# и .NET, PHP, Go и Rust, Ruby и Elixir. Включены сразу: next_run_at по умолчанию
-- — время миграции, поэтому ближайший tick возьмёт их и разнесёт первые опросы (spreadDelay). Канал,
-- который уже есть — например, 0010 создала его из legacy_posts, а 0014 включила, — не трогаем.
INSERT INTO "sources" ("connector", "key", "platform", "name", "enabled")
SELECT 'open-telegram', "key", 'geekjobs', "key", true
FROM (VALUES ('forallqa'), ('fordevops'), ('forfrontend'), ('forallmobile'), ('forpython'), ('alljvmjobs'), ('forcpp'), ('forcsharp'), ('jobforphp'), ('forgoandrust'), ('forruby')) AS "channels" ("key")
ON CONFLICT ("connector", "key") DO NOTHING;
