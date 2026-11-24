/**
 * Задание «опроси источник»: его раздаёт tick, а продолжение кладёт сам обработчик (П7).
 * `idempotencyKey` — ключ, по которому очередь отбрасывает повтор того же задания.
 */
export type DrainSourceJob = {
  readonly sourceId: string;
  /** Через сколько секунд очередь отдаёт задание. */
  readonly delaySeconds: number;
  readonly idempotencyKey: string;
};

/**
 * Очередь заданий опроса. В тестах — `memoryJobQueue`, реализацию на Vercel Queues даст план
 * подключения очереди. `Error` — задания не отправлены.
 */
export type JobQueue = {
  readonly enqueue: (jobs: readonly DrainSourceJob[]) => Promise<Error | undefined>;
};
