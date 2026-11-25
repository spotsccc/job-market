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
 * Задание «разбери публикацию»: его кладёт обработчик опроса, а повтор после сбоя — сам
 * обработчик разбора. Ключ — `mineJobKey` (П5 плана разбора).
 */
export type MineJob = {
  readonly publicationId: string;
  /** Через сколько секунд очередь отдаёт задание. */
  readonly delaySeconds: number;
  readonly idempotencyKey: string;
};

/**
 * Очередь заданий одного вида. В тестах — `memoryJobQueue`, реализацию на Vercel Queues даст
 * план подключения очереди. `Error` — задания не отправлены.
 */
export type JobQueue<Job> = {
  readonly enqueue: (jobs: readonly Job[]) => Promise<Error | undefined>;
};

/** Сколько заданий уходит в очередь одним вызовом `enqueue` (П2 плана тика). */
export const BATCH_SIZE = 100;
