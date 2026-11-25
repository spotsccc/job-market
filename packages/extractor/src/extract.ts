import { gateway } from '@ai-sdk/gateway';
import type { VacancyToSave } from '@job-market/db';
import { formatPublication } from '@job-market/publication-text';
import type { PublicationForModel } from '@job-market/publication-text';
import { generateText, Output } from 'ai';
import type { LanguageModel } from 'ai';

import { ExtractionError } from './errors/index.ts';
import { normalizeVacancy } from './normalize.ts';
import { isLeaf } from './occupations.ts';
import type { OccupationNode } from './occupations.ts';
import { extractorInstructions } from './prompt.ts';
import { vacancySchema } from './vacancy.ts';
import type { ModelPlace, ModelVacancy } from './vacancy.ts';

/**
 * Модель экстрактора через Vercel AI Gateway. Ключ — `AI_GATEWAY_API_KEY`; без него на
 * Vercel gateway берёт OIDC-токен деплоя. Id моделей — из https://ai-gateway.vercel.sh/v1/models.
 * Haiku: в 20 раз дешевле Sonnet 5.5 при тех же structured outputs.
 */
export const EXTRACTOR_MODEL_ID = 'anthropic/claude-haiku-5.5';

export const defaultExtractorModel: LanguageModel = gateway(EXTRACTOR_MODEL_ID);

/**
 * Предел одного вызова модели вместе с повторами AI SDK. Без него зависший вызов
 * держит функцию до `maxDuration`, и Vercel обрывает её посреди работы.
 */
const MODEL_CALL_TIMEOUT_MS = 60_000;

/**
 * Без рассуждений: извлечение полей — простая задача, а токены рассуждений
 * оплачиваются как выход и в разы удорожают вызов.
 */
const REASONING = 'none';

/**
 * Роль публикации: поля строки `vacancies` без публикации и номера (номер — индекс в ответе),
 * `schemaVersion` 2, и места словами текста. Места к гео-справочнику сводит `locateVacancies`
 * пакета geo: он же даёт `isRemoteFromAnywhere` и `locations` (П16).
 */
export type ExtractedRole = {
  readonly [
    K in Exclude<
      keyof VacancyToSave,
      'places' | 'locations' | 'isRemoteFromAnywhere' | 'occupationId'
    >
  ]-?: Exclude<VacancyToSave[K], undefined>;
} & {
  /** У версии 2 профессия есть всегда, хотя бы `root`. */
  readonly occupationId: string;
  readonly places: readonly ModelPlace[];
};

export type ExtractOptions = {
  /** Дерево профессий: из него строятся перечисление схемы и строки промпта. */
  readonly occupations: readonly OccupationNode[];
  readonly model?: LanguageModel;
};

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- тип выведен из zod-схемы, массивы в нём изменяемые
function toRole(tree: readonly OccupationNode[], vacancy: ModelVacancy): ExtractedRole {
  const { salary, occupation, suggestedOccupation, ...fields } = vacancy;
  return {
    schemaVersion: 2,
    title: fields.title.trim(),
    company: fields.company,
    companyUrl: fields.companyUrl,
    hiringParty: fields.hiringParty,
    occupationId: occupation,
    // Подсказка нужна, только когда модель остановилась выше листа (П12).
    suggestedOccupation: isLeaf(tree, occupation) ? null : suggestedOccupation,
    seniority: fields.seniority,
    experienceYearsMin: fields.experienceYearsMin,
    workplace: fields.workplace,
    employmentTypes: fields.employmentTypes,
    salaryMin: salary?.min ?? null,
    salaryMax: salary?.max ?? null,
    salaryCurrency: salary?.currency ?? null,
    salaryPeriod: salary?.period ?? null,
    salaryRaw: salary?.raw ?? null,
    salaryGross: salary?.gross ?? null,
    equity: fields.equity,
    skills: fields.skills,
    niceSkills: fields.niceSkills,
    languages: fields.languages,
    relocation: fields.relocation,
    visaSponsorship: fields.visaSponsorship,
    apply: fields.apply,
    summary: fields.summary,
    responsibilities: fields.responsibilities,
    requirements: fields.requirements,
    benefits: fields.benefits,
    places: fields.places,
  };
}

/**
 * Достаёт роли из публикации, которая уже признана вакансией. Роли — в порядке ответа
 * модели, то есть в порядке текста, после нормализации (П10–П15). Сбой провайдера, таймаут
 * или ответ не по схеме — в том числе ноль ролей (П5) и профессия не из переданного дерева
 * (E3) — `ExtractionError` с исходной ошибкой в `cause`.
 */
export async function extract(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- в публикации `Date`, глубоко readonly его не сделать
  publication: PublicationForModel,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- модель AI SDK — объект провайдера, readonly его не сделать
  options: ExtractOptions,
): Promise<ExtractionError | readonly ExtractedRole[]> {
  const { occupations } = options;
  const result = await generateText({
    model: options.model ?? defaultExtractorModel,
    abortSignal: AbortSignal.timeout(MODEL_CALL_TIMEOUT_MS),
    reasoning: REASONING,
    instructions: extractorInstructions(occupations),
    prompt: formatPublication(publication),
    output: Output.object({ schema: vacancySchema(occupations) }),
  }).catch((cause: unknown) => new ExtractionError({ cause }));
  if (result instanceof Error) return result;
  return result.output.vacancies.map(
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- тип выведен из zod-схемы, массивы в нём изменяемые
    (vacancy) => toRole(occupations, normalizeVacancy(vacancy)),
  );
}
