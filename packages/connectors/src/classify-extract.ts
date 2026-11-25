import { classify } from '@job-market/classifier';
import { extract } from '@job-market/extractor';
import { skipReason } from '@job-market/publication-text';
import type { LanguageModel } from 'ai';

import type { Processor } from './contract.ts';

/** Модели разбора; движок берёт настоящие, тесты — фейковые. */
export type ProcessModels = {
  readonly classifier: LanguageModel;
  readonly extractor: LanguageModel;
};

/** Пояснение итога, когда публикация шла в экстрактор как вакансия, а он ролей не нашёл (П8). */
export const NO_ROLES_NOTE = 'экстрактор не нашёл ролей';

/**
 * `process` для коннекторов, публикации которых разбираются одинаково (П8): классификатор, и
 * только для вакансии — экстрактор с деревом профессий. Пустую публикацию отсекает классификатор. Ошибка любой модели — `Error` значением.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- модели AI SDK — объекты провайдера, readonly их не сделать
export function classifyAndExtract(models: ProcessModels): Processor {
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- в публикации `Date`, глубоко readonly его не сделать
  return async (publication, { occupations }) => {
    const classification = await classify(publication, { model: models.classifier });
    if (classification instanceof Error) return classification;
    if (classification.kind === 'not_vacancy') return classification;

    const roles = await extract(publication, { occupations, model: models.extractor });
    if (roles instanceof Error) return roles;
    if (roles.length === 0) {
      return { kind: 'not_vacancy', reason: 'trash', note: NO_ROLES_NOTE };
    }
    return { kind: 'vacancy', roles };
  };
}

/**
 * `process` для коннекторов, у которых каждая публикация — вакансия, как у доски вакансий
 * компании (П9 плана Greenhouse): только экстрактор, классификатор не зовётся. Публикацию без
 * единой буквы отсекает сам, без модели. Ошибка модели — `Error` значением.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- модели AI SDK — объекты провайдера, readonly их не сделать
export function extractOnly(models: Pick<ProcessModels, 'extractor'>): Processor {
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- в публикации `Date`, глубоко readonly его не сделать
  return async (publication, { occupations }) => {
    if (skipReason(publication.content) !== undefined)
      return { kind: 'not_vacancy', reason: 'empty' };

    const roles = await extract(publication, { occupations, model: models.extractor });
    if (roles instanceof Error) return roles;
    if (roles.length === 0) {
      return { kind: 'not_vacancy', reason: 'trash', note: NO_ROLES_NOTE };
    }
    return { kind: 'vacancy', roles };
  };
}
