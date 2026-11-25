import { z } from 'zod';

import type { ConnectorDefinition, Processor } from '../contract.ts';
import type { GreenhouseChannel } from './channel.ts';
import { parseGreenhouse } from './parse.ts';
import type { GreenhouseConfig, GreenhouseCursor } from './parse.ts';

/** Токен доски: латинские буквы, цифры, дефис и подчёркивание (П1). */
const boardToken = z.string().regex(/^[A-Za-z0-9_-]+$/u);

/** Настройки источника: токен доски. Без него токен — ключ источника (П1). */
const configSchema: z.ZodType<GreenhouseConfig> = z.strictObject({ board: boardToken.optional() });

/** Курсор: момент в UTC, позже которого вакансии ещё не читались (П5). */
const cursorSchema: z.ZodType<GreenhouseCursor> = z.strictObject({
  publishedAfter: z.iso.datetime(),
});

export type GreenhouseDeps = {
  readonly greenhouse: Pick<GreenhouseChannel, 'fetchJobs'>;
  readonly process: Processor;
};

/** Коннектор досок вакансий компаний на Greenhouse: один источник — одна доска. */
export function greenhouse(
  deps: GreenhouseDeps,
): ConnectorDefinition<GreenhouseConfig, GreenhouseCursor> {
  return {
    id: 'greenhouse',
    configSchema,
    cursorSchema,
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- в публикации `Date`, глубоко readonly его не сделать
    parse: async (input) => parseGreenhouse(deps.greenhouse, input),
    process: deps.process,
  };
}
