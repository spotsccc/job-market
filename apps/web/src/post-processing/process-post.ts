import type { NewLegacyPostRow, NewLegacyVacancyRow } from '@job-market/db';
import type { NotVacancyReason } from '@job-market/db/values';
import { generateText, Output } from 'ai';

import type { ExtractedVacancy } from '../vacancy/vacancy.ts';
import { defaultPostProcessingModels } from './models.ts';
import type { PostProcessingModels } from './models.ts';
import { CLASSIFIER_INSTRUCTIONS, EXTRACTOR_INSTRUCTIONS, formatPost } from './prompts.ts';
import { postClassificationSchema, vacancyExtractionSchema } from './schemas.ts';

/**
 * Предел одного вызова модели вместе с повторами AI SDK. Без него зависший вызов
 * держит функцию до `maxDuration`, и Vercel обрывает её посреди работы.
 */
const MODEL_CALL_TIMEOUT_MS = 60_000;

/**
 * Без рассуждений: классификация и извлечение полей — простые задачи, а токены
 * рассуждений оплачиваются как выход и в разы удорожают вызов.
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

async function extract(
  post: Post,
  models: PostProcessingModels,
): Promise<Error | readonly Vacancy[]> {
  const result = await generateText({
    model: models.extractor,
    abortSignal: AbortSignal.timeout(MODEL_CALL_TIMEOUT_MS),
    reasoning: REASONING,
    instructions: EXTRACTOR_INSTRUCTIONS,
    prompt: formatPost(post),
    output: Output.object({ schema: vacancyExtractionSchema }),
  }).catch(
    (cause: unknown) => new Error(`Post ${post.externalId} vacancy extraction failed`, { cause }),
  );
  if (result instanceof Error) return result;
  // Позиция роли — её индекс в ответе модели: по `(postId, position)` повторный разбор перезаписывает строки.
  return result.output.vacancies.map(toVacancy);
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

  const vacancies = await extract(post, models);
  if (vacancies instanceof Error) return vacancies;

  return { kind: 'vacancy', post, vacancies };
}
