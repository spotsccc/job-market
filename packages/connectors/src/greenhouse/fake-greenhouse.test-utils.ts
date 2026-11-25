import type { GreenhouseChannel, GreenhouseJob } from './channel.ts';
import { GreenhouseRequestError } from './errors/greenhouse-request-error.ts';

export type FakeGreenhouseOptions = {
  /** Номер вызова `fetchJobs`, на котором поддельная доска отвечает 503. */
  readonly failOnCall?: number;
};

export type FakeGreenhouse = Pick<GreenhouseChannel, 'fetchJobs'> & {
  /** Сколько раз звали `fetchJobs`. */
  calls: number;
  /** Токены досок по порядку вызовов. */
  readonly boards: string[];
};

/**
 * Поддельный Greenhouse: вакансии по токену доски. Список читается на каждом вызове, поэтому
 * тест может добавить вакансию между опросами. Неизвестная доска отвечает 404.
 */
export function fakeGreenhouse(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- `ReadonlyMap` линтер не считает глубоко readonly
  jobs: ReadonlyMap<string, readonly GreenhouseJob[]>,
  options: FakeGreenhouseOptions = {},
): FakeGreenhouse {
  const fake: FakeGreenhouse = {
    calls: 0,
    boards: [],
    async fetchJobs(board: string): Promise<GreenhouseRequestError | readonly GreenhouseJob[]> {
      // Ответ приходит в следующей задаче, как от настоящего Greenhouse.
      await Promise.resolve();
      fake.calls += 1;
      fake.boards.push(board);
      if (fake.calls === options.failOnCall) {
        return new GreenhouseRequestError({ board, cause: new Error('HTTP 503') });
      }
      const found = jobs.get(board);
      if (found === undefined) {
        return new GreenhouseRequestError({ board, cause: new Error('HTTP 404') });
      }
      return [...found];
    },
  };
  return fake;
}

/** Вакансия доски wrike; поля можно заменить. */
export function greenhouseJob(overrides: Partial<GreenhouseJob> = {}): GreenhouseJob {
  return {
    id: 4_664_056_005,
    title: 'Account Development Manager',
    absoluteUrl: 'https://job-boards.greenhouse.io/wrike/jobs/4664056005',
    content: '&lt;p&gt;Wrike is hiring an Account Development Manager in Prague.&lt;/p&gt;',
    updatedAt: '2026-11-04T07:16:11-05:00',
    firstPublished: '2026-02-19T05:41:46-05:00',
    companyName: 'Wrike',
    location: 'Prague',
    departments: ['3210 Expand EMEA'],
    offices: ['Czech Republic'],
    requisitionId: '222',
    language: 'en',
    ...overrides,
  };
}
