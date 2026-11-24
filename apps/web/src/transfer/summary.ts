import type { LinkStatus } from '@job-market/db/values';

import type { Written } from './outcome.ts';

export type TransferError = { readonly externalId: string; readonly error: string };

/** Итог запуска, который печатает скрипт переноса. Его копит запуск по ходу пачек. */
export type TransferSummary = {
  /** Постов взято в запуск. */
  posts: number;
  /** Публикаций со статусом `vacancy`. */
  published: number;
  vacancies: number;
  duplicates: number;
  /** Посты без текста: `not_vacancy` без вызова модели (П5). */
  notVacancy: number;
  errors: TransferError[];
  /** Публикацию уже записал другой запуск (E6, packages/db/src/publication/README.md). */
  alreadyTransferred: number;
  /** Копии, оригинал которых упал в этом запуске: ждут следующего (П4). */
  postponed: number;
  /** Ссылки постов по статусам енричера (П8): сколько прочитано, не открылось, без читателя. */
  links: Record<LinkStatus, number>;
  /** Вакансии по профессиям. */
  occupations: Map<string, number>;
  places: { resolved: number; partial: number; unresolved: number; anywhere: number };
  /** Почему запуск остановлен раньше (E8); `null` — дошёл до конца. */
  stopped: string | null;
};

export function emptySummary(): TransferSummary {
  return {
    posts: 0,
    published: 0,
    vacancies: 0,
    duplicates: 0,
    notVacancy: 0,
    errors: [],
    alreadyTransferred: 0,
    postponed: 0,
    links: { read: 0, no_data: 0, failed: 0, unsupported: 0, over_limit: 0 },
    occupations: new Map(),
    places: { resolved: 0, partial: 0, unresolved: 0, anywhere: 0 },
    stopped: null,
  };
}

/** Записанный пост в итоге: копии, посты без ролей, вакансии с профессиями и местами. */
export function countWritten(summary: TransferSummary, outcome: Written): void {
  if (outcome.kind === 'duplicate') summary.duplicates += 1;
  if (outcome.kind === 'not_vacancy') summary.notVacancy += 1;
  if (outcome.kind !== 'vacancy') return;
  summary.published += 1;
  summary.vacancies += outcome.roles.length;
  for (const role of outcome.roles) {
    const occupation = role.occupationId ?? 'root';
    summary.occupations.set(occupation, (summary.occupations.get(occupation) ?? 0) + 1);
    if (role.isRemoteFromAnywhere) summary.places.anywhere += 1;
    for (const place of role.places) {
      if (place.resolution === 'resolved') summary.places.resolved += 1;
      else if (place.resolution === 'partial') summary.places.partial += 1;
      else summary.places.unresolved += 1;
    }
  }
}
