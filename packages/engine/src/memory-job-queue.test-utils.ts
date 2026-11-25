import type { DrainSourceJob, JobQueue } from './job-queue.ts';

export type MemoryJobQueueOptions = {
  /** Номер вызова `enqueue`, на котором очередь отвечает `Error` и ничего не запоминает. */
  readonly failOnBatch?: number;
};

export type MemoryJobQueue<Job = DrainSourceJob> = JobQueue<Job> & {
  /** Отправленные задания по порядку. */
  readonly jobs: readonly Job[];
};

/** Очередь в памяти для тестов движка: запоминает задания и не отдаёт их. */
export function memoryJobQueue<Job = DrainSourceJob>(
  options: MemoryJobQueueOptions = {},
): MemoryJobQueue<Job> {
  const jobs: Job[] = [];
  let batches = 0;

  async function enqueue(batch: readonly Job[]): Promise<Error | undefined> {
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
