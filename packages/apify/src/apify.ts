import { tryAsync } from '@spotsccc/error-as-value';
import { ApifyClient } from 'apify-client';

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

export type Apify = {
  /**
   * Запускает актор, ждёт окончания и читает весь датасет запуска. Элементы не проверяются:
   * их разбирает тот, кто знает формат актора, и при ошибке возвращает `ActorOutputError`.
   */
  readonly runActor: (
    actorId: string,
    input: Readonly<Record<string, unknown>>,
    options?: RunActorOptions,
  ) => Promise<ApifyRequestError | ActorRunError | ActorRun>;
};

export function createApify(options: ApifyOptions): Apify {
  const client = new ApifyClient({
    token: options.token,
    ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
    ...(options.maxRetries === undefined ? {} : { maxRetries: options.maxRetries }),
  });

  async function runActor(
    actorId: string,
    input: Readonly<Record<string, unknown>>,
    runOptions: RunActorOptions = {},
  ): Promise<ApifyRequestError | ActorRunError | ActorRun> {
    const run = await client
      .actor(actorId)
      .call(input, {
        log: null,
        ...(runOptions.waitSecs === undefined ? {} : { waitSecs: runOptions.waitSecs }),
      })
      .catch((cause: unknown) => new ApifyRequestError({ actorId, cause }));
    if (run instanceof Error) return run;

    if (run.status !== 'SUCCEEDED') {
      return new ActorRunError({ runId: run.id, status: run.status });
    }

    // Итератор сам листает страницы датасета и бросает при ошибке запроса.
    const items = await tryAsync(
      async (): Promise<unknown[]> => {
        const collected: unknown[] = [];
        for await (const item of client.dataset(run.defaultDatasetId).listItems()) {
          collected.push(item);
        }
        return collected;
      },
      (cause: unknown) => new ApifyRequestError({ actorId, cause }),
    );
    if (items instanceof Error) return items;

    return { runId: run.id, items };
  }

  return { runActor };
}
