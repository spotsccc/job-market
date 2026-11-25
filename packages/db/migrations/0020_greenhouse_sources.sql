-- Доски вакансий компаний на Greenhouse (П11 плана greenhouse): платформа и 42 источника коннектора
-- greenhouse. Ключ — токен доски, имя — название компании, интервал — сутки (по умолчанию).
-- Токены сверены вручную 25 ноября 2026: название доски совпадает с компанией
-- (docs/research/greenhouse-boards.csv). Четыре крупные доски — nebius, gitlab, affirm и
-- veeamsoftware — заведены выключенными: их включают отдельной миграцией, когда разбор на остальных
-- досках проверен. Включённые next_run_at по умолчанию — время миграции: ближайший tick возьмёт их
-- и разнесёт первые опросы. Платформу и источник, которые уже есть, не трогаем.
INSERT INTO "platforms" ("id", "name") VALUES ('greenhouse', 'Greenhouse')
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
INSERT INTO "sources" ("connector", "key", "platform", "name", "enabled")
SELECT 'greenhouse', "key", 'greenhouse', "name", "enabled"
FROM (VALUES
  ('abbyy', 'ABBYY', true),
  ('affirm', 'Affirm', false),
  ('ahrefsjobs', 'Ahrefs', true),
  ('appodeal', 'Appodeal', true),
  ('avride', 'Avride', true),
  ('behavox', 'Behavox', true),
  ('bigid', 'BigID', true),
  ('coherentsolutions', 'Coherent Solutions', true),
  ('compasspathways', 'Compass Pathways', true),
  ('dbeaver', 'DBeaver', true),
  ('eqvilentjobs', 'Eqvilent', true),
  ('finom', 'Finom', true),
  ('flohealth', 'Flo Health', true),
  ('fxpro', 'FxPro', true),
  ('gitlab', 'GitLab', false),
  ('groupib', 'Group-IB', true),
  ('humansignal', 'HumanSignal', true),
  ('inbank', 'Inbank', true),
  ('innovecs', 'Innovecs', true),
  ('lokalise', 'Lokalise', true),
  ('momentus', 'Momentus', true),
  ('nebius', 'Nebius', false),
  ('nix', 'N-iX', true),
  ('noomgrowth', 'Noom', true),
  ('nortal', 'Nortal', true),
  ('novacredit', 'Nova Credit', true),
  ('orioninnovation', 'Orion Innovation', true),
  ('pandadoc', 'PandaDoc', true),
  ('platacard', 'Plata', true),
  ('prodlyjobs', 'Prodly', true),
  ('realtimeboardglobal', 'Miro', true),
  ('seranking', 'SE Ranking', true),
  ('silananotechnologies', 'Sila Nanotechnologies', true),
  ('stackadapt', 'StackAdapt', true),
  ('toloka', 'Toloka', true),
  ('transfergo', 'TransferGo', true),
  ('veeamsoftware', 'Veeam', false),
  ('veriff', 'Veriff', true),
  ('wargamingen', 'Wargaming', true),
  ('wheely', 'Wheely', true),
  ('wrike', 'Wrike', true),
  ('xometryeurope', 'Xometry Europe', true)
) AS "boards" ("key", "name", "enabled")
ON CONFLICT ("connector", "key") DO NOTHING;
