-- Начальное дерево профессий из снимка packages/extractor/eval/occupations.json (П19 плана
-- vacancy-extraction), утверждённого владельцем. root уже есть из 0008_data_model. Дерево до
-- админки меняет только миграция: в том же коммите обновляются снимок и разметка набора.
INSERT INTO "occupations" ("id", "parent_id", "name", "description") VALUES
  ('it', 'root', 'IT', 'Создание и эксплуатация софта и IT-инфраструктуры: разработка, данные, тестирование, безопасность, администрирование. Продакт-менеджер IT-продукта — не сюда, а в product; разработчик игр — в gamedev.'),
  ('product', 'root', 'Продукт и проекты', 'Управление продуктами и проектами. Выбирай этот узел, если роль управленческая про продукт или проект, но какая именно — не понять.'),
  ('design', 'root', 'Дизайн', 'Визуальный и продуктовый дизайн. Выбирай этот узел, если роль — дизайнер, но направление не понять. Художник игр — в game_artist; Design Engineer, который пишет код, — в frontend.'),
  ('gamedev', 'root', 'Геймдев', 'Создание игр. Выбирай этот узел, если роль в игровой компании, но направление не понять. Маркетинг игр — в marketing; аналитика игр — в data_analyst.'),
  ('marketing', 'root', 'Маркетинг и PR', 'Продвижение и коммуникации. Выбирай этот узел для маркетолога без ясного направления, руководителя маркетинга, CMO, бренд- и продуктового маркетинга.'),
  ('media', 'root', 'Медиа и продакшн', 'Создание контента как продукта: редакции, видео, онлайн-курсы, блогеры. Выбирай этот узел, если роль в медиа, но направление не понять.'),
  ('sales', 'root', 'Продажи и работа с клиентами', 'Продажи и удержание клиентов. Выбирай этот узел, если роль про клиентов, но направление не понять, и для руководителя продаж.'),
  ('hr', 'root', 'HR', 'Работа с людьми компании. Выбирай этот узел для HR-специалиста без ясного направления и для HRD.'),
  ('business', 'root', 'Управление и бизнес-функции', 'Руководство компанией и поддерживающие функции. Выбирай этот узел для роли, которая не подходит ни к одной ветке выше.'),
  ('engineering', 'it', 'Разработка', 'Разработчики, которые пишут код продукта. Выбирай этот узел, если роль — разработчик, но направление (frontend, backend, мобильная и т. д.) из текста не понять.'),
  ('qa', 'it', 'Тестирование', 'Проверка качества софта: ручное тестирование, автотесты, QA Engineer, SDET, QA Lead.'),
  ('data', 'it', 'Данные и ML', 'Работа с данными и моделями машинного обучения. Выбирай этот узел, если роль про данные, но направление из текста не понять.'),
  ('systems_analyst', 'it', 'Системный и бизнес-анализ', 'Требования к IT-системам: системный аналитик, бизнес-аналитик, постановка задач разработке, BPMN, UML. Анализ данных и метрик — в data_analyst.'),
  ('security', 'it', 'Информационная безопасность', 'Защита систем и данных: AppSec, пентест, SOC, специалист по ИБ, DevSecOps.'),
  ('it_operations', 'it', 'Администрирование и поддержка', 'Эксплуатация IT в компании: системный администратор, сетевой инженер, техническая поддержка пользователей и второй линии, 1С-администратор. Поддержка клиентов продукта без технической работы — в customer_success.'),
  ('engineering_manager', 'it', 'Руководство разработкой', 'Руководит инженерами, а не пишет код как основную работу: Engineering Manager, Head of Engineering, CTO, руководитель отдела разработки. Tech Lead, который пишет код, — по направлению кода, например backend.'),
  ('product_manager', 'product', 'Продакт-менеджер', 'Отвечает за то, что и зачем делает продукт: Product Manager, Product Owner, CPO, Growth PM.'),
  ('project_manager', 'product', 'Проджект-менеджер', 'Отвечает за сроки и процесс: Project Manager, Delivery Manager, Scrum Master, Agile Coach, руководитель проектов. Продюсер игры — в game_producer; продюсер онлайн-курсов и медиа — в media_producer.'),
  ('product_designer', 'design', 'Продуктовый и UX/UI-дизайн', 'Интерфейсы сайтов и приложений: Product Designer, UX/UI, UX-исследователь, веб-дизайнер интерфейсов.'),
  ('graphic_designer', 'design', 'Графический дизайн', 'Айдентика, брендинг, иллюстрации, баннеры, креативы, презентации, полиграфия. Креативы с анимацией и видео — в motion_designer.'),
  ('motion_designer', 'design', 'Моушн и 3D', 'Анимация, моушн-дизайн, 3D-визуализация вне игр. 3D-артист для игры — в game_artist; монтаж видео — в video.'),
  ('game_developer', 'gamedev', 'Разработчик игр', 'Программирование игр и игровых движков: Unity, Unreal, Godot, игровой клиент и сервер. Backend для неигрового продукта — в backend.'),
  ('game_designer', 'gamedev', 'Геймдизайнер', 'Механики, баланс, уровни, нарратив и экономика игры: Game Designer, Level Designer, Narrative Designer.'),
  ('game_artist', 'gamedev', 'Художник игр', 'Арт для игр: 2D и 3D-художники, концепт-арт, аниматоры персонажей, VFX, UI-художник игры.'),
  ('game_producer', 'gamedev', 'Продюсер игр', 'Ведёт игру или игровую фичу как продукт и проект: Game Producer, продюсер, менеджер игрового проекта, LiveOps.'),
  ('performance_marketing', 'marketing', 'Performance-маркетинг', 'Платный трафик и привлечение: таргетолог, специалист по контекстной рекламе, медиабайер, арбитраж трафика, User Acquisition, CPA-маркетинг.'),
  ('seo', 'marketing', 'SEO', 'Поисковая оптимизация и органический трафик: SEO-специалист, линкбилдинг, ASO.'),
  ('content_marketing', 'marketing', 'Контент и SMM', 'Контент для каналов компании: SMM-менеджер, контент-маркетолог, копирайтер, email-маркетинг, комьюнити-менеджер. Редактор и журналист медиа — в editor.'),
  ('pr', 'marketing', 'PR и коммуникации', 'Связи со СМИ и репутация: PR-менеджер, внутренние и внешние коммуникации, GR, пресс-секретарь.'),
  ('editor', 'media', 'Редактор и автор', 'Тексты как продукт: журналист, редактор, шеф-редактор, автор, сценарист, методист онлайн-курсов. Тексты для продвижения компании — в content_marketing.'),
  ('video', 'media', 'Видео', 'Съёмка и монтаж: видеомонтажёр, видеограф, режиссёр монтажа, оператор.'),
  ('media_producer', 'media', 'Продюсер', 'Запускает и ведёт медиапроекты: продюсер онлайн-курсов и инфопродуктов, продюсер блогеров, YouTube, подкастов, мероприятий. Продюсер игр — в game_producer.'),
  ('sales_manager', 'sales', 'Менеджер по продажам', 'Закрывает сделки: Account Executive, менеджер по продажам B2B и B2C, SDR, BDR, лидогенерация звонками и письмами, менеджер по работе с ключевыми клиентами на продажу.'),
  ('business_development', 'sales', 'Развитие бизнеса и партнёрства', 'Новые рынки, партнёры и крупные сделки: Business Development Manager, партнёрский менеджер, менеджер по партнёрствам.'),
  ('customer_success', 'sales', 'Customer Success и поддержка', 'Работа с текущими клиентами: Customer Success, Account Manager на удержание, поддержка клиентов, оператор чата, Customer Support. Техническая поддержка IT-инфраструктуры — в it_operations.'),
  ('recruiter', 'hr', 'Рекрутер', 'Подбор сотрудников: рекрутер, IT-рекрутер, сорсер, Talent Acquisition.'),
  ('hr_generalist', 'hr', 'HR-бизнес-партнёр и HR-generalist', 'Всё остальное в HR: HRBP, HR-generalist, обучение и развитие, HR-бренд, C&B, кадровое делопроизводство.'),
  ('executive', 'business', 'Топ-менеджмент', 'Руководит компанией или её направлением целиком: CEO, COO, генеральный директор, управляющий партнёр, руководитель бизнес-юнита. CTO — в engineering_manager, CMO — в marketing, CPO — в product_manager.'),
  ('operations', 'business', 'Операции и администрирование', 'Процессы и офис: операционный менеджер, офис-менеджер, ассистент руководителя, закупки, логистика.'),
  ('finance', 'business', 'Финансы и юристы', 'Деньги и право: финансовый аналитик, бухгалтер, финансовый директор, юрист, комплаенс.'),
  ('frontend', 'engineering', 'Frontend', 'Интерфейсы в браузере: React, Vue, Angular, Next.js, вёрстка, UI Engineer, Design Engineer. Fullstack с React и Node — не сюда, а в fullstack; мобильные приложения на React Native — в mobile.'),
  ('backend', 'engineering', 'Backend', 'Серверная часть: API, сервисы, базы данных на Go, Java, Python, Node.js, PHP, C#, Rust и т. п. Если роль требует и серверную часть, и интерфейс — fullstack; если инфраструктуру и деплой — devops.'),
  ('fullstack', 'engineering', 'Fullstack и Product Engineer', 'Роль ведёт фичи целиком — и интерфейс, и серверную часть: Fullstack, Product Engineer, Founding Engineer, «React + Node». Если интерфейс упомянут только как плюс — backend.'),
  ('mobile', 'engineering', 'Мобильная разработка', 'Приложения для iOS и Android: Swift, Kotlin, Flutter, React Native. Мобильная игра на Unity — не сюда, а в game_developer.'),
  ('ai_engineer', 'engineering', 'AI Engineer', 'Продукты поверх готовых моделей: LLM-приложения, агенты, RAG, промпты, интеграции с API моделей, Applied AI Engineer. Обучение и исследование моделей — не сюда, а в ml_engineer.'),
  ('devops', 'engineering', 'DevOps и SRE', 'Инфраструктура, CI/CD, облака, Kubernetes, надёжность и мониторинг: DevOps, SRE, Platform Engineer. Администрирование офисной IT-инфраструктуры и поддержка пользователей — в it_operations.'),
  ('embedded', 'engineering', 'Embedded и системная разработка', 'Код для железа и низкоуровневые системы: микроконтроллеры, прошивки, драйверы, C/C++ под устройства. Backend на C++ — в backend.'),
  ('solutions_engineer', 'engineering', 'Solutions и Forward Deployed Engineer', 'Инженер, который пишет код рядом с клиентом: внедрения, интеграции под заказчика, пресейл с технической частью, Forward Deployed Engineer, Solutions Engineer. Продажи без кода — в sales.'),
  ('devrel', 'engineering', 'DevRel', 'Работа с сообществом разработчиков: Developer Advocate, DevRel, Developer Experience, техническое писательство о продукте для разработчиков.'),
  ('data_analyst', 'data', 'Аналитика данных', 'Анализ данных для решений: Data Analyst, продуктовый аналитик, BI-аналитик, маркетинговый аналитик, SQL и дашборды. Системный и бизнес-аналитик требований — не сюда, а в systems_analyst.'),
  ('data_engineer', 'data', 'Data Engineer', 'Пайплайны и хранилища данных: ETL, DWH, Spark, Airflow, dbt, Analytics Engineer.'),
  ('ml_engineer', 'data', 'ML и Data Science', 'Обучение и исследование моделей: Data Scientist, ML Engineer, MLOps, Computer Vision, NLP, Research Scientist. Продукт поверх готовых LLM без обучения моделей — в ai_engineer.');
--> statement-breakpoint
-- Источники для переноса legacy_posts (Э4): 14 каналов GeekJobs, которые собирал краулер, и все
-- другие каналы из external_id постов telegram — тоже GeekJobs: краулер собирал только их
-- каналы. Ручной поиск LinkedIn — linkedin/manual. Выключены: опрашивать их начнёт движок, а
-- DEFAULT столбца enabled — true. По (connector, key) их найдёт импорт источников.
INSERT INTO "sources" ("connector", "key", "platform", "name", "enabled")
SELECT 'open-telegram', "key", 'geekjobs', "key", false
FROM (
  SELECT "key" FROM (VALUES ('forallsales'), ('fordesigner'), ('forproducts'), ('forallmedia'), ('forhr'), ('forproducer'), ('remotegeekjob'), ('geekjobs'), ('jobforjunior'), ('forchiefs'), ('jobfortm'), ('forallmarketing'), ('jobforpr'), ('forgamedev')) AS "channels" ("key")
  UNION
  SELECT split_part("external_id", '/', 1) FROM "legacy_posts" WHERE "source" = 'telegram'
) AS "keys"
ON CONFLICT ("connector", "key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "sources" ("connector", "key", "platform", "name", "enabled")
VALUES ('linkedin', 'manual', 'linkedin', 'LinkedIn: ручной поиск', false)
ON CONFLICT ("connector", "key") DO NOTHING;
