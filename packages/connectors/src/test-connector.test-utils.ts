import type { Connector as ConnectorId } from '@job-market/db/values';
import type { Reader } from '@job-market/enricher';
import { z } from 'zod';

import { assemble } from './assemble.ts';
import type { Connector, Parser, Processor } from './contract.ts';
import type { Locate } from './mine.ts';

export type TestConnectorParts = {
  readonly parse?: Parser<unknown, unknown>;
  readonly process?: Processor;
  /** По умолчанию принимает любой `config`. */
  readonly configSchema?: z.ZodType;
  readonly readers?: readonly Reader[];
  /** Гео-справочник `mine`; по умолчанию — настоящий. */
  readonly locate?: Locate;
};

const nothingRead: Parser<unknown, unknown> = () =>
  Promise.resolve({ publications: [], cursor: null, more: false });

const notCalled: Processor = () => Promise.resolve(new Error('process is not set in this test'));

/**
 * Коннектор в форме записи реестра с заданными `parse` и `process`: `drain` и `mine` — те же
 * общие функции, что собирает `createConnectors`. Для тестов `drain`, `mine` и движка.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- схема zod и читатели — объекты библиотек, readonly их не сделать
export function testConnector(id: ConnectorId, parts: TestConnectorParts = {}): Connector {
  return assemble(
    {
      id,
      configSchema: parts.configSchema ?? z.unknown(),
      cursorSchema: z.unknown(),
      parse: parts.parse ?? nothingRead,
      process: parts.process ?? notCalled,
    },
    {
      readers: parts.readers ?? [],
      ...(parts.locate === undefined ? {} : { locate: parts.locate }),
    },
  );
}
