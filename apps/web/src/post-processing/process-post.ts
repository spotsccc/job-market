import type { NewLegacyPostRow, NewLegacyVacancyRow, PostSource } from '@job-market/db';
import type { Connector, NotVacancyReason } from '@job-market/db/values';
import { extract } from '@job-market/extractor';
import type { ExtractedRole, OccupationNode } from '@job-market/extractor';
import { isAnywhere } from '@job-market/geo';
import type { PublicationForModel } from '@job-market/publication-text';
import { generateText, Output } from 'ai';

import { defaultPostProcessingModels } from './models.ts';
import type { PostProcessingModels } from './models.ts';
import { CLASSIFIER_INSTRUCTIONS, formatPost } from './prompts.ts';
import { postClassificationSchema } from './schemas.ts';

/**
 * Предел одного вызова модели вместе с повторами AI SDK. Без него зависший вызов
 * держит функцию до `maxDuration`, и Vercel обрывает её посреди работы.
 */
const MODEL_CALL_TIMEOUT_MS = 60_000;

/**
 * Без рассуждений: классификация — простая задача, а токены рассуждений оплачиваются
 * как выход и в разы удорожают вызов.
 */
const REASONING = 'none';
import type { PostClassification } from './schemas.ts';

/** Пост в виде строки таблицы `legacy_posts`, без полей, которые заполняет база. */
export type Post = Readonly<Omit<NewLegacyPostRow, 'id' | 'createdAt'>>;

type ReadonlyArray_<T> = T extends (infer E)[] ? readonly E[] : T;
type VacancyFields = Required<
  Omit<NewLegacyVacancyRow, 'id' | 'postId' | 'createdAt' | 'updatedAt'>
>;

/**
 * Вакансия в виде строки таблицы `legacy_vacancies`, все поля заданы: `postId` проставляет
 * тот, кто сохраняет пост. Массивы только для чтения — при вставке их копируют.
 */
export type Vacancy = {
  readonly [K in keyof VacancyFields]: ReadonlyArray_<Exclude<VacancyFields[K], undefined>>;
};

export type ProcessedPost =
  | {
      readonly kind: 'vacancy';
      readonly post: Post;
      /** Роли в порядке поста, `position` — индекс в списке. */
      readonly vacancies: readonly Vacancy[];
    }
  | {
      /** Пост не вакансия — это обычный результат, а не ошибка. */
      readonly kind: 'not_vacancy';
      readonly reason: NotVacancyReason;
      readonly note: string;
    };

/**
 * Дерево из одного корня: старой модели профессия не нужна, а экстрактор без дерева не
 * работает. Этот разбор и `legacy_vacancies` удаляются после сверки переноса постов.
 */
const LEGACY_TREE: readonly OccupationNode[] = [
  { id: 'root', parentId: null, name: 'Без профессии', description: 'Профессия не нужна.' },
];

/** Роль экстрактора в строку `legacy_vacancies`: места — словами, навыки — одним списком. */
function toVacancy(role: ExtractedRole, position: number): Vacancy {
  return {
    position,
    title: role.title,
    company: role.company,
    companyUrl: role.companyUrl,
    hiringParty: role.hiringParty,
    seniority: role.seniority,
    workplace: role.workplace,
    isRemoteFromAnywhere: role.places.some(
      (place) => place.role === 'hiring' && isAnywhere(place.region ?? ''),
    ),
    locations: role.places.map((place) => place.raw),
    employmentTypes: role.employmentTypes,
    salaryMin: role.salaryMin,
    salaryMax: role.salaryMax,
    salaryCurrency: role.salaryCurrency,
    salaryPeriod: role.salaryPeriod,
    salaryRaw: role.salaryRaw,
    skills: [...role.skills, ...role.niceSkills],
    relocation: role.relocation,
    visaSponsorship: role.visaSponsorship,
    apply: role.apply,
    summary: role.summary,
  };
}

async function classify(
  post: Post,
  models: PostProcessingModels,
): Promise<Error | PostClassification> {
  const result = await generateText({
    model: models.classifier,
    abortSignal: AbortSignal.timeout(MODEL_CALL_TIMEOUT_MS),
    reasoning: REASONING,
    instructions: CLASSIFIER_INSTRUCTIONS,
    prompt: formatPost(post),
    output: Output.object({ schema: postClassificationSchema }),
  }).catch(
    (cause: unknown) => new Error(`Post ${post.externalId} classification failed`, { cause }),
  );
  if (result instanceof Error) return result;
  return result.output;
}

/** Коннектор публикации по источнику поста `legacy_posts`. */
const CONNECTOR_BY_SOURCE: Readonly<Record<PostSource, Connector>> = {
  telegram: 'open-telegram',
  linkedin: 'linkedin',
};

/** Пост `legacy_posts` в виде публикации, которую видит экстрактор. */
function toPublication(post: Post): PublicationForModel {
  return {
    connector: CONNECTOR_BY_SOURCE[post.source],
    content: post.content,
    postedAt: post.postedAt,
    author: {
      name: post.authorName,
      url: post.authorUrl,
      headline: post.authorHeadline ?? null,
    },
  };
}

/**
 * Разбирает пост из любого источника в две модели: классификатор решает, вакансия
 * ли это, и только для вакансий экстрактор достаёт поля ролей. Ничего не сохраняет:
 * вакансии возвращаются готовыми строками для базы, рядом с исходным постом.
 */
export async function processPost(
  post: Post,
  models: PostProcessingModels = defaultPostProcessingModels,
): Promise<Error | ProcessedPost> {
  // Репост или пост из одних картинок: классифицировать нечего, модель не зовём.
  if (post.content.trim() === '') {
    return { kind: 'not_vacancy', reason: 'not_hiring', note: 'Пост без текста' };
  }

  const classification = await classify(post, models);
  if (classification instanceof Error) return classification;
  if (classification.verdict !== 'vacancy') {
    return { kind: 'not_vacancy', reason: classification.verdict, note: classification.note };
  }

  const extracted = await extract(toPublication(post), {
    occupations: LEGACY_TREE,
    model: models.extractor,
  });
  if (extracted instanceof Error) {
    return new Error(`Post ${post.externalId} vacancy extraction failed`, { cause: extracted });
  }

  // Позиция роли — её индекс в ответе модели: по `(postId, position)` повторный разбор перезаписывает строки.
  return {
    kind: 'vacancy',
    post,
    vacancies: extracted.map((role, position) => toVacancy(role, position)),
  };
}
