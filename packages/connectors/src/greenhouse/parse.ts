import type { ParsedPublication, ParseInput, ParseResult } from '../contract.ts';
import type { GreenhouseChannel, GreenhouseJob } from './channel.ts';
import { jobContent } from './job-content.ts';

export type GreenhouseConfig = {
  /** Токен доски; без него — ключ источника (П1). */
  readonly board?: string | undefined;
};

export type GreenhouseCursor = {
  /** Самая поздняя дата публикации среди прочитанных вакансий, ISO 8601 в UTC (П5). */
  readonly publishedAfter: string;
};

/** Дата публикации вакансии: `first_published`, без него — `updated_at` (П4). */
const publishedAt = (job: GreenhouseJob): Date => new Date(job.firstPublished ?? job.updatedAt);

function toPublication(board: string, job: GreenhouseJob): ParsedPublication {
  return {
    externalId: `${board}/${String(job.id)}`,
    url: job.absoluteUrl,
    content: jobContent(job),
    publishedAt: publishedAt(job),
    author:
      job.companyName === null
        ? null
        : {
            externalId: board,
            name: job.companyName,
            url: `https://job-boards.greenhouse.io/${board}`,
            headline: null,
          },
    payload: {
      title: job.title,
      location: job.location,
      departments: job.departments,
      offices: job.offices,
      requisitionId: job.requisitionId,
      updatedAt: job.updatedAt,
      language: job.language,
    },
  };
}

/**
 * Опрос доски одним запросом (П2–П7). Без курсора берутся все вакансии доски, в том числе
 * старше `since`: на доске только открытые вакансии, и многие открыты давно (П3). С курсором —
 * опубликованные позже него; даты сравниваются как моменты, а не строки (E3). Курсор — самая
 * поздняя дата публикации в ответе (П5). Доска не прочиталась — `Error` (П6).
 */
export async function parseGreenhouse(
  channel: Pick<GreenhouseChannel, 'fetchJobs'>,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- в публикации `Date`, глубоко readonly его не сделать
  input: ParseInput<GreenhouseConfig, GreenhouseCursor>,
): Promise<Error | ParseResult<GreenhouseCursor>> {
  const board = input.config.board ?? input.key;
  const jobs = await channel.fetchJobs(board);
  if (jobs instanceof Error) return jobs;

  const after = input.cursor === null ? null : Date.parse(input.cursor.publishedAfter);
  const fresh = jobs.filter((job) => after === null || publishedAt(job).getTime() > after);
  const publications = fresh.map((job) => toPublication(board, job));

  const latest = Math.max(...fresh.map((job) => publishedAt(job).getTime()));
  const cursor = Number.isFinite(latest)
    ? { publishedAfter: new Date(latest).toISOString() }
    : input.cursor;
  return { publications, cursor, more: false };
}
