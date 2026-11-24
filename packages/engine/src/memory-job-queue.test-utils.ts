import type { DrainSourceJob, JobQueue } from './job-queue.ts';

export type MemoryJobQueueOptions = {
  /** Номер вызова `enqueue`, на котором очередь отвечает `Error` и ничего не запоминает. */
  readonly failOnBatch?: number;
};

export type MemoryJobQueue = JobQueue & {
  /** Отправленные задания по порядку. */
  readonly jobs: readonly DrainSourceJob[];
};

/** Очередь в памяти для тестов движка: запоминает задания и не отдаёт их. */
export function memoryJobQueue(options: MemoryJobQueueOptions = {}): MemoryJobQueue {
  const jobs: DrainSourceJob[] = [];
  let batches = 0;
  async function enqueue(batch: readonly DrainSourceJob[]): Promise<Error | undefined> {
    // Ответ приходит в следующей задаче, как от настоящей очереди.
    await Promise.resolve();
    batches += 1;
    if (batches === options.failOnBatch) {
      return new Error(`Memory queue failed on batch ${String(batches)}`);
    }
    jobs.push(...batch);
    return undefined;
  }
  return { jobs, enqueue };
}
