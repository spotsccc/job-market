import { ActorOutputError } from '@job-market/apify';
import type { ActorRunError, Apify, ApifyRequestError } from '@job-market/apify';
import { z } from 'zod';

import type { Reader } from '../reader.ts';
import { linkedinPath } from './linkedin-url.ts';

/** https://apify.com/apimaestro/linkedin-job-detail — выбран в spike Э0. */
export const LINKEDIN_JOB_ACTOR_ID = 'apimaestro~linkedin-job-detail';

/** Больше id актор за один запуск не принимает. */
export const MAX_JOB_IDS = 100;

const WAIT_SECS = 60;

/** `/jobs/view/4479627327/`, `/jobs/view/qa-engineering-lead-ai-at-meta-4486617493`. */
const JOB_PATH = /^\/jobs\/view\/(?:[^/]*\D)?(\d+)\/?$/u;

/** Только поля, которые идут в раздел; лишние и `null` в необязательных не ломают разбор. */
const JobItemSchema = z.object({
  job_info: z.object({
    job_posting_id: z.number(),
    title: z.string().nullish(),
    description: z.string().nullish(),
    location: z.string().nullish(),
  }),
  company_info: z.object({ name: z.string().nullish() }).nullish(),
});

type JobItem = z.infer<typeof JobItemSchema>;

/** Название · компания · место, ниже описание как есть: актор отдаёт текст, а не HTML. */
function jobBody(item: JobItem): string | null {
  const description = item.job_info.description?.trim() ?? '';
  if (description === '') return null;
  const heading = [item.job_info.title, item.company_info?.name, item.job_info.location]
    .map((part) => part?.trim() ?? '')
    .filter((part) => part !== '')
    .join(' · ');
  return heading === '' ? description : `${heading}\n${description}`;
}

export function parseJobUrl(url: string): string | null {
  const path = linkedinPath(url);
  return path === null ? null : (JOB_PATH.exec(path)?.[1] ?? null);
}

/** Читатель вакансий LinkedIn: один запуск актора на все id вызова. */
export function createLinkedinJobReader(apify: Apify): Reader {
  async function fetch(
    ids: readonly string[],
  ): Promise<ApifyRequestError | ActorRunError | ActorOutputError | ReadonlyMap<string, string>> {
    if (ids.length > MAX_JOB_IDS) {
      throw new RangeError(
        `At most ${String(MAX_JOB_IDS)} job ids per call, got ${String(ids.length)}`,
      );
    }
    const run = await apify.runActor(
      LINKEDIN_JOB_ACTOR_ID,
      { job_id: ids },
      { waitSecs: WAIT_SECS },
    );
    if (run instanceof Error) return run;

    const wanted = new Set(ids);
    const bodies = new Map<string, string>();
    for (const [index, item] of run.items.entries()) {
      const parsed = JobItemSchema.safeParse(item);
      if (!parsed.success)
        return new ActorOutputError({ index, runId: run.runId, cause: parsed.error });
      // Ответ сопоставляется по id, а не по порядку: актор пропускает неверные id.
      const id = String(parsed.data.job_info.job_posting_id);
      const body = jobBody(parsed.data);
      if (wanted.has(id) && body !== null) bodies.set(id, body);
    }
    return bodies;
  }

  return { kind: 'linkedin-job', label: 'Вакансия LinkedIn', parseUrl: parseJobUrl, fetch };
}
