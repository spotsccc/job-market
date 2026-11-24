import { findCause, tryAsync } from '@spotsccc/error-as-value';
import { ApifyApiError, ApifyClient } from 'apify-client';

import { ActorRunError } from './errors/actor-run-error.ts';
import { ApifyRequestError } from './errors/apify-request-error.ts';

export type ApifyOptions = {
  readonly token: string;
  /** По умолчанию `https://api.apify.com`. */
  readonly baseUrl?: string;
  /** Повторы при 429, 5xx и сетевых ошибках, по умолчанию 8. */
  readonly maxRetries?: number;
};

export type RunActorOptions = {
  /** Сколько секунд ждать окончания запуска. Без него ждём, пока запуск не закончится. */
  readonly waitSecs?: number;
};

/** Законченный запуск: его id для `ActorOutputError` и весь датасет по порядку. */
export type ActorRun = {
  readonly runId: string;
  readonly items: readonly unknown[];
};

/** Запуск ещё идёт: `collectRun` дождался `waitSecs`, а запуск не закончился. */
export type RunningRun = 'running';

export type Apify = {
  /**
   * Запускает актор, ждёт окончания и читает весь датасет запуска. Элементы не проверяются:
   * их разбирает тот, кто знает формат актора, и при ошибке возвращает `ActorOutputError`.
   * Запуск, который не закончился за `waitSecs`, — `ActorRunError` со статусом `RUNNING`.
   */
  readonly runActor: (
    actorId: string,
    input: Readonly<Record<string, unknown>>,
    options?: RunActorOptions,
  ) => Promise<ApifyRequestError | ActorRunError | ActorRun>;
  /** Запускает актор и не ждёт его: ответ — id запуска для `collectRun`. */
  readonly startActor: (
    actorId: string,
    input: Readonly<Record<string, unknown>>,
  ) => Promise<ApifyRequestError | string>;
  /**
   * Ждёт запуск не дольше `waitSecs` и читает его датасет. Запуск идёт — `'running'`, закончился
   * не `SUCCEEDED` — `ActorRunError`.
   */
  readonly collectRun: (
    runId: string,
    waitSecs?: number,
  ) => Promise<ApifyRequestError | ActorRunError | RunningRun | ActorRun>;
};

/** Статусы запуска, который ещё не закончился. */
const UNFINISHED = new Set(['READY', 'RUNNING']);

/** Кончились кредиты Apify (402): повтор не поможет, пока их не пополнят. */
export function isOutOfCredits(error: Readonly<Error>): boolean {
  return findCause(error, ApifyApiError)?.statusCode === 402;
}

/** Весь датасет запуска по порядку: итератор сам листает страницы и бросает при ошибке запроса. */
async function readDataset(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- клиент apify-client — изменяемый объект библиотеки
  client: ApifyClient,
  datasetId: string,
  actorId: string,
): Promise<ApifyRequestError | unknown[]> {
  return tryAsync(
    async (): Promise<unknown[]> => {
      const collected: unknown[] = [];
      for await (const item of client.dataset(datasetId).listItems()) collected.push(item);
      return collected;
    },
    (cause: unknown) => new ApifyRequestError({ actorId, cause }),
  );
}

async function collectRun(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- клиент apify-client — изменяемый объект библиотеки
  client: ApifyClient,
  runId: string,
  waitSecs?: number,
): Promise<ApifyRequestError | ActorRunError | RunningRun | ActorRun> {
  const actorId = `of run ${runId}`;
  const run = await client
    .run(runId)
    .waitForFinish(waitSecs === undefined ? {} : { waitSecs })
    .catch((cause: unknown) => new ApifyRequestError({ actorId, cause }));
  if (run instanceof Error) return run;
  if (UNFINISHED.has(run.status)) return 'running';
  if (run.status !== 'SUCCEEDED') {
    return new ActorRunError({ runId: run.id, status: run.status });
  }
  const items = await readDataset(client, run.defaultDatasetId, actorId);
  if (items instanceof Error) return items;
  return { runId: run.id, items };
}

export function createApify(options: ApifyOptions): Apify {
  const client = new ApifyClient({
    token: options.token,
    ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
    ...(options.maxRetries === undefined ? {} : { maxRetries: options.maxRetries }),
  });

  async function startActor(
    actorId: string,
    input: Readonly<Record<string, unknown>>,
  ): Promise<ApifyRequestError | string> {
    const run = await client
      .actor(actorId)
      .start(input)
      .catch((cause: unknown) => new ApifyRequestError({ actorId, cause }));
    if (run instanceof Error) return run;
    return run.id;
  }

  async function runActor(
    actorId: string,
    input: Readonly<Record<string, unknown>>,
    runOptions: RunActorOptions = {},
  ): Promise<ApifyRequestError | ActorRunError | ActorRun> {
    const runId = await startActor(actorId, input);
    if (runId instanceof Error) return runId;
    const run = await collectRun(client, runId, runOptions.waitSecs);
    if (run === 'running') return new ActorRunError({ runId, status: 'RUNNING' });
    return run;
  }

  return {
    runActor,
    startActor,
    collectRun: async (runId, waitSecs) => collectRun(client, runId, waitSecs),
  };
}
