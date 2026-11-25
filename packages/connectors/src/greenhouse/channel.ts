import { createHttpClient } from '@job-market/http-client';
import { z } from 'zod';

import { GreenhouseRequestError } from './errors/greenhouse-request-error.ts';

const DEFAULT_BASE_URL = 'https://boards-api.greenhouse.io';
const DEFAULT_TIMEOUT_MS = 30_000;

export type GreenhouseChannelOptions = {
  /** По умолчанию `https://boards-api.greenhouse.io`. */
  readonly baseUrl?: string;
  /** Таймаут запроса доски, по умолчанию 30 секунд. */
  readonly timeoutMs?: number;
};

/** Вакансия доски: поля ответа, которые нужны коннектору. */
export type GreenhouseJob = {
  readonly id: number;
  readonly title: string;
  readonly absoluteUrl: string;
  /** Описание — HTML, записанный сущностями: `&lt;p&gt;…`. */
  readonly content: string;
  /** ISO 8601 со смещением: `2026-02-19T05:41:46-05:00`. */
  readonly updatedAt: string;
  readonly firstPublished: string | null;
  readonly companyName: string | null;
  readonly location: string | null;
  readonly departments: readonly string[];
  readonly offices: readonly string[];
  readonly requisitionId: string | null;
  readonly language: string | null;
};

export type GreenhouseChannel = {
  /** Все открытые вакансии доски с текстом одним запросом (П2). */
  readonly fetchJobs: (board: string) => Promise<GreenhouseRequestError | readonly GreenhouseJob[]>;
};

const named = z.array(z.object({ name: z.string() })).nullish();
const moment = z.iso.datetime({ offset: true });

/**
 * Схема ответа: только нужные поля, лишние пропускаются — Greenhouse добавляет поля без
 * предупреждения.
 */
const boardSchema = z.object({
  jobs: z.array(
    z.object({
      id: z.int(),
      title: z.string(),
      absolute_url: z.string(),
      content: z.string().nullish(),
      updated_at: moment,
      first_published: moment.nullish(),
      company_name: z.string().nullish(),
      location: z.object({ name: z.string().nullish() }).nullish(),
      departments: named,
      offices: named,
      requisition_id: z.string().nullish(),
      language: z.string().nullish(),
    }),
  ),
});

type BoardJob = z.infer<typeof boardSchema>['jobs'][number];

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- тип выведен из zod-схемы, массивы в нём изменяемые
const names = (items: BoardJob['departments']): readonly string[] =>
  (items ?? []).map((item) => item.name.trim()).filter((name) => name !== '');

const text = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
};

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- тип выведен из zod-схемы, массивы в нём изменяемые
function toJob(job: BoardJob): GreenhouseJob {
  return {
    id: job.id,
    title: job.title,
    absoluteUrl: job.absolute_url,
    content: job.content ?? '',
    updatedAt: job.updated_at,
    firstPublished: job.first_published ?? null,
    companyName: text(job.company_name),
    location: text(job.location?.name),
    departments: names(job.departments),
    offices: names(job.offices),
    requisitionId: text(job.requisition_id),
    language: text(job.language),
  };
}

export function parseBoard(data: unknown): Error | readonly GreenhouseJob[] {
  const parsed = boardSchema.safeParse(data);
  if (!parsed.success) {
    return new Error('Greenhouse board response has unexpected shape', { cause: parsed.error });
  }
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- тип выведен из zod-схемы, массивы в нём изменяемые
  return parsed.data.jobs.map((job) => toJob(job));
}

/**
 * Доски вакансий Greenhouse через открытый Job Board API: без ключа, один запрос отдаёт все
 * открытые вакансии доски с текстом (П2, П6).
 */
export function createGreenhouseChannel(options: GreenhouseChannelOptions = {}): GreenhouseChannel {
  const client = createHttpClient({ baseUrl: options.baseUrl ?? DEFAULT_BASE_URL });
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function fetchJobs(
    board: string,
  ): Promise<GreenhouseRequestError | readonly GreenhouseJob[]> {
    const jobs = await client.request({
      path: `/v1/boards/${encodeURIComponent(board)}/jobs`,
      query: { content: true },
      signal: AbortSignal.timeout(timeoutMs),
      parse: parseBoard,
    });
    if (jobs instanceof Error) return new GreenhouseRequestError({ board, cause: jobs });
    return jobs;
  }

  return { fetchJobs };
}
