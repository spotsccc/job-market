import { z } from 'zod';

import type { ConnectorDefinition, Processor } from '../contract.ts';
import type { LinkedinChannel } from './channel.ts';
import { parseLinkedin } from './parse.ts';
import type { LinkedinConfig, LinkedinCursor } from './parse.ts';

/** Больше постов на запрос за опрос не берём: платим за каждый пост. */
export const MAX_POSTS = 100;

/** Настройки поискового источника: запросы и сколько постов брать. */
const configSchema: z.ZodType<LinkedinConfig> = z.strictObject({
  queries: z.array(z.string().trim().min(1)).min(1),
  maxPosts: z.int().min(1).max(MAX_POSTS),
  postedLimit: z.enum(['1h', '24h', 'week', 'month']).optional(),
  sortBy: z.enum(['relevance', 'date']).optional(),
});

const cursorSchema: z.ZodType<LinkedinCursor> = z.strictObject({ runId: z.string().min(1) });

export type LinkedinDeps = {
  readonly linkedin: LinkedinChannel;
  readonly process: Processor;
};

/** Коннектор поиска постов LinkedIn через актор Apify. */
export function linkedin(deps: LinkedinDeps): ConnectorDefinition<LinkedinConfig, LinkedinCursor> {
  return {
    id: 'linkedin',
    configSchema,
    cursorSchema,
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- в сообщении и публикации `Date`, глубоко readonly его не сделать
    parse: async (input) => parseLinkedin(deps.linkedin, input),
    process: deps.process,
  };
}
