import type { Reader } from './reader.ts';

export type FakeReaderOptions = {
  readonly kind?: string;
  readonly label?: string;
  /** Id ссылки, если она этого читателя. */
  readonly match: (url: string) => string | null;
  /** Тела разделов по id. Id, которого здесь нет, — «нет данных». */
  readonly items?: Readonly<Record<string, string>>;
  /** Сколько первых вызовов `fetch` заканчиваются сбоем. */
  readonly failCalls?: number;
  /** Сбой — исключение, а не ошибка значением. */
  readonly throws?: boolean;
};

export type FakeReader = Reader & {
  /** Id каждого вызова `fetch` по порядку. */
  readonly calls: readonly (readonly string[])[];
};

/** Читатель без внешних запросов для тестов енричера и тех, кто его зовёт. */
export function fakeReader(options: FakeReaderOptions): FakeReader {
  const calls: (readonly string[])[] = [];
  const items = options.items ?? {};

  async function fetch(ids: readonly string[]): Promise<Error | ReadonlyMap<string, string>> {
    // Ответ приходит в следующей задаче, как от настоящего читателя.
    await Promise.resolve();
    calls.push(ids);
    if (calls.length <= (options.failCalls ?? 0)) {
      const error = new Error(`Fake reader failed on call ${String(calls.length)}`);
      if (options.throws === true) throw error;
      return error;
    }
    const found = ids.flatMap((id) => {
      const body = items[id];
      return body === undefined ? [] : [[id, body] as const];
    });
    return new Map(found);
  }

  return {
    kind: options.kind ?? 'fake',
    label: options.label ?? 'Страница',
    parseUrl: options.match,
    fetch,
    calls,
  };
}
