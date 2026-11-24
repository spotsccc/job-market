import type { Reader } from '@job-market/enricher';

import type { Connector, ConnectorDefinition } from './contract.ts';
import { drain } from './drain.ts';
import { mine } from './mine.ts';
import type { Locate } from './mine.ts';

export type AssembleOptions = {
  /** Читатели енричера: `drain` дочитывает ими ссылки (П13). */
  readonly readers: readonly Reader[];
  /** Гео-справочник `mine`; по умолчанию — `locateVacancies`. */
  readonly locate?: Locate;
};

/**
 * Коннектор снаружи из его `parse` и `process` (П1): `drain` и `mine` одни на все коннекторы.
 * Им собирает коннекторы реестр, а тесты — `testConnector`.
 */
export function assemble<Config, Cursor>(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- в определении схемы zod и `Date` публикаций, глубоко readonly их не сделать
  definition: ConnectorDefinition<Config, Cursor>,
  options: AssembleOptions,
): Connector {
  return {
    id: definition.id,
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- в определении схемы zod и `Date` публикаций, глубоко readonly их не сделать
    drain: async (source, drainOptions) =>
      drain(definition, source, { ...drainOptions, readers: options.readers }),
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- в определении схемы zod и `Date` публикаций, глубоко readonly их не сделать
    mine: async (publication) => mine(definition, publication, options.locate),
  };
}
