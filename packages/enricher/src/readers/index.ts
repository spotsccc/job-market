import { createApify } from '@job-market/apify';

import type { Reader } from '../reader.ts';
import { createLinkedinJobReader } from './linkedin-job.ts';
import { createLinkedinPostReader } from './linkedin-post.ts';

export type ReadersOptions = {
  /** Токен Apify; вызывающий читает его из `APIFY_TOKEN`. */
  readonly apifyToken: string;
};

/** Все читатели. Порядок — кто первым получает ссылку, которую узнали несколько. */
export function createReaders(options: ReadersOptions): readonly Reader[] {
  const apify = createApify({ token: options.apifyToken });
  return [createLinkedinJobReader(apify), createLinkedinPostReader(apify)];
}
