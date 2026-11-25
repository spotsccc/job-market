import type { Connector as ConnectorId, PUBLICATION_STATUSES } from '@job-market/db/values';
import type { ExtractedRole, OccupationNode } from '@job-market/extractor';
import type { PublicationForModel } from '@job-market/publication-text';
import type { z } from 'zod';

type PublicationStatus = (typeof PUBLICATION_STATUSES)[number];

/** Глубина первого опроса источника: публикации не старше стольких дней (П4). */
export const DEPTH_DAYS = 7;

/** Автор публикации, как его отдаёт сервис (П7). */
export type ParsedAuthor = {
  /** Id автора внутри коннектора: юзернейм канала, `in/<handle>` или `company/<имя>`. */
  readonly externalId: string;
  readonly name: string;
  readonly url: string;
  /** Подпись в профиле; есть только у LinkedIn. */
  readonly headline: string | null;
};

/** Публикация, прочитанная `parse`, до записи (П7). */
export type ParsedPublication = {
  /** Id публикации внутри коннектора: `forhr/9120` у open-telegram, id поста у linkedin. */
  readonly externalId: string;
  readonly url: string;
  /** Текст в Markdown; пустая строка — текста нет. */
  readonly content: string;
  /** Когда опубликована; `null` — сервис не сообщил, `drain` пишет `now` (П10). */
  readonly publishedAt: Date | null;
  readonly author: ParsedAuthor | null;
  /** Поля для `process` своего коннектора; форма своя у каждого. */
  readonly payload?: Readonly<Record<string, unknown>>;
};

/** Что получает `parse`: настройки и курсор источника уже проверены схемами коннектора. */
export type ParseInput<Config, Cursor> = {
  readonly config: Config;
  /** `null` — опросов не было или курсор не прошёл `cursorSchema`: первый опрос (П4). */
  readonly cursor: Cursor | null;
  /** Ключ источника внутри коннектора: юзернейм канала, имя поискового запроса. */
  readonly key: string;
  /** Публикации старше не берутся: `now − DEPTH_DAYS` (П4, П9). */
  readonly since: Date;
  /** `Date.now()`, после которого новый запрос к сервису не начинается (П5). */
  readonly deadline: number;
};

/**
 * Что прочитал `parse` (П2, П5, П6). `cursor` — докуда прочитано, `null` — курсора ещё нет.
 * `more` — прочитано не всё, продолжит следующий опрос. `error` — сбой сервиса посреди прохода:
 * прочитанное и курсор последней удачной страницы всё равно возвращаются.
 */
export type ParseResult<Cursor> = {
  readonly publications: readonly ParsedPublication[];
  readonly cursor: Cursor | null;
  readonly more: boolean;
  readonly error?: Error;
};

/** Чтение сервиса без базы (П2). `Error` — не прочитано ничего. */
export type Parser<Config, Cursor> = (
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- в публикации `Date`, глубоко readonly его не сделать
  input: ParseInput<Config, Cursor>,
) => Promise<Error | ParseResult<Cursor>>;

/**
 * Итог разбора публикации (П3). Роли — с местами словами текста, к справочнику их сводит `mine`.
 * `empty` — в тексте нет ни одной буквы; `trash` — не вакансия, почему — в `note`.
 */
export type ProcessOutcome =
  | { readonly kind: 'vacancy'; readonly roles: readonly ExtractedRole[] }
  | { readonly kind: 'not_vacancy'; readonly reason: 'empty' }
  | { readonly kind: 'not_vacancy'; readonly reason: 'trash'; readonly note: string };

export type ProcessOptions = {
  /** Дерево профессий: его читает `mine`, `process` остаётся без базы (П3). */
  readonly occupations: readonly OccupationNode[];
};

/** Разбор одной публикации моделями без базы (П3). `Error` — сбой модели, таймаут, ответ не по схеме. */
export type Processor = (
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- в публикации `Date`, глубоко readonly его не сделать
  publication: PublicationForModel,
  options: ProcessOptions,
) => Promise<Error | ProcessOutcome>;

/**
 * Коннектор изнутри (П1): схемы `config` и `cursor`, `parse` и `process`. `drain` и `mine`
 * собираются из них одни на все коннекторы.
 */
export type ConnectorDefinition<Config = unknown, Cursor = unknown> = {
  readonly id: ConnectorId;
  /** Схема `sources.config`: что читать — канал, запрос. */
  readonly configSchema: z.ZodType<Config>;
  /** Схема `sources.cursor`: докуда уже прочитано. */
  readonly cursorSchema: z.ZodType<Cursor>;
  readonly parse: Parser<Config, Cursor>;
  readonly process: Processor;
};

/** Источник, который опрашивает `drain`: строка `sources`, нужные ему столбцы. */
export type DrainSource = {
  readonly id: string;
  readonly key: string;
  readonly config: unknown;
  readonly cursor: unknown;
};

export type DrainOptions = {
  readonly now: Date;
  /** `Date.now()`, после которого `parse` не начинает новый запрос (П5). */
  readonly deadline: number;
};

/**
 * Итог `drain` (П11): `done` — прочитано всё, `more` — продолжит следующий опрос, `failed` —
 * сбой сервиса или неверный `config`, причина в `error`. `inserted` — сколько новых публикаций
 * записано, `cursor` — курсор источника после опроса.
 */
export type DrainResult = {
  readonly status: 'done' | 'more' | 'failed';
  readonly inserted: number;
  /**
   * Id публикаций, которые этот `drain` записал впервые, — все они `pending` и ждут разбора
   * (П8 разбора, packages/engine/README.md). Записанные раньше в него не входят.
   */
  readonly pendingIds: readonly string[];
  readonly cursor: unknown;
  readonly error?: Error;
};

/** Публикация для `mine`: как её видит модель, плюс id и статус строки `publications`. */
export type MinePublication = PublicationForModel & {
  readonly id: string;
  readonly status: PublicationStatus;
};

/**
 * Итог `mine` (П12): `skipped` — статус не `pending` и не `processing`, модели не звались;
 * `duplicate` — все роли публикации уже сохранены из других публикаций.
 */
export type MineResult = {
  readonly status: 'vacancy' | 'not_vacancy' | 'duplicate' | 'skipped';
  /** Сколько вакансий записано: дубли не считаются. */
  readonly vacancies: number;
};

/** Коннектор снаружи (П1): то, что зовёт движок. */
export type Connector = {
  readonly id: ConnectorId;
  /** Выкачивает новые публикации источника и пишет их с курсором. `Error` — только сбой базы. */
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- в публикации `Date`, глубоко readonly его не сделать
  readonly drain: (source: DrainSource, options: DrainOptions) => Promise<Error | DrainResult>;
  /** Добывает вакансии из публикации и пишет их с итогом разбора. */
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- в публикации `Date`, глубоко readonly его не сделать
  readonly mine: (publication: MinePublication) => Promise<Error | MineResult>;
};
