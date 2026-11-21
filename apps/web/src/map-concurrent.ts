/** `Promise.all` по `items`, но не больше `limit` вызовов `fn` одновременно. */
export async function mapConcurrent<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  // Один итератор на всех: каждый воркер берёт следующий ещё не взятый элемент.
  const queue = items.entries();
  async function worker(): Promise<void> {
    for (const [index, item] of queue) {
      // Последовательно внутри воркера — так и ограничивается параллельность.
      // oxlint-disable-next-line eslint/no-await-in-loop
      results[index] = await fn(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
