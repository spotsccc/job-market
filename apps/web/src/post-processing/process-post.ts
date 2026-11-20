import type { LinkedinPost } from '@job-market/channel-linkedin';
import type { NotVacancyReason } from '@job-market/core';
import type { NewPostRow, NewVacancyRow } from '@job-market/db';
import { generateText, Output } from 'ai';

import type { ExtractedVacancy } from '../vacancy/vacancy.ts';
import { defaultPostProcessingModels } from './models.ts';
import type { PostProcessingModels } from './models.ts';
import { CLASSIFIER_INSTRUCTIONS, EXTRACTOR_INSTRUCTIONS, formatPost } from './prompts.ts';
import { postClassificationSchema, vacancyExtractionSchema } from './schemas.ts';
import type { PostClassification } from './schemas.ts';

/** Пост в виде строки таблицы `posts`, без полей, которые заполняет база. */
export type Post = Readonly<Omit<NewPostRow, 'id' | 'createdAt'>>;

type ReadonlyArray_<T> = T extends (infer E)[] ? readonly E[] : T;
type VacancyFields = Required<Omit<NewVacancyRow, 'id' | 'postId' | 'createdAt' | 'updatedAt'>>;

/**
 * Вакансия в виде строки таблицы `vacancies`, все поля заданы: `postId` проставляет
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

function toPost(post: LinkedinPost): Post {
  return {
    source: 'linkedin',
    externalId: post.id,
    url: post.url,
    content: post.content,
    postedAt: post.postedAt,
    authorName: post.author.name,
    authorUrl: post.author.url,
    authorHeadline: post.author.headline,
    authorHandle: post.author.publicIdentifier,
  };
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- тип выведен из zod-схемы, массивы в нём изменяемые
function toVacancy(vacancy: ExtractedVacancy, position: number): Vacancy {
  const { salary, ...fields } = vacancy;
  return {
    ...fields,
    position,
    salaryMin: salary?.min ?? null,
    salaryMax: salary?.max ?? null,
    salaryCurrency: salary?.currency ?? null,
    salaryPeriod: salary?.period ?? null,
    salaryRaw: salary?.raw ?? null,
  };
}

async function classify(
  post: LinkedinPost,
  models: PostProcessingModels,
): Promise<Error | PostClassification> {
  const result = await generateText({
    model: models.classifier,
    instructions: CLASSIFIER_INSTRUCTIONS,
    prompt: formatPost(post),
    output: Output.object({ schema: postClassificationSchema }),
  }).catch((cause: unknown) => new Error(`Post ${post.id} classification failed`, { cause }));
  if (result instanceof Error) return result;
  return result.output;
}

async function extract(
  post: LinkedinPost,
  models: PostProcessingModels,
): Promise<Error | readonly Vacancy[]> {
  const result = await generateText({
    model: models.extractor,
    instructions: EXTRACTOR_INSTRUCTIONS,
    prompt: formatPost(post),
    output: Output.object({ schema: vacancyExtractionSchema }),
  }).catch((cause: unknown) => new Error(`Post ${post.id} vacancy extraction failed`, { cause }));
  if (result instanceof Error) return result;
  // Позиция роли — её индекс в ответе модели: по `(postId, position)` повторный разбор перезаписывает строки.
  return result.output.vacancies.map(toVacancy);
}

/**
 * Разбирает пост LinkedIn в две модели: классификатор решает, вакансия ли это, и
 * только для вакансий экстрактор достаёт поля ролей. Ничего не сохраняет: пост и
 * вакансии возвращаются готовыми строками для базы.
 */
export async function processLinkedinPost(
  post: LinkedinPost,
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

  const vacancies = await extract(post, models);
  if (vacancies instanceof Error) return vacancies;

  return {
    kind: 'vacancy',
    post: toPost(post),
    vacancies,
  };
}
