import type { Reader } from '@job-market/enricher';

import { assemble } from './assemble.ts';
import { classifyAndExtract } from './classify-extract.ts';
import type { ProcessModels } from './classify-extract.ts';
import type { Connector } from './contract.ts';
import type { LinkedinChannel } from './linkedin/channel.ts';
import { linkedin } from './linkedin/index.ts';
import type { TelegramChannel } from './open-telegram/channel.ts';
import { openTelegram } from './open-telegram/index.ts';

export type { ProcessModels } from './classify-extract.ts';
export { DEPTH_DAYS } from './contract.ts';
export type {
  Connector,
  ConnectorDefinition,
  DrainOptions,
  DrainResult,
  DrainSource,
  MinePublication,
  MineResult,
  ParsedAuthor,
  ParsedPublication,
  ParseInput,
  ParseResult,
  ProcessOutcome,
} from './contract.ts';
export { createLinkedinChannel } from './linkedin/channel.ts';
export type { LinkedinChannel, LinkedinChannelOptions } from './linkedin/channel.ts';
export { createTelegramChannel } from './open-telegram/channel.ts';
export type { TelegramChannel, TelegramChannelOptions } from './open-telegram/channel.ts';

/**
 * Что коннекторам нужно снаружи (П1): каналы сервисов, модели разбора и читатели енричера.
 * Движок создаёт их с ключами из окружения, тесты подставляют фейки.
 */
export type ConnectorDeps = {
  readonly telegram: Pick<TelegramChannel, 'fetchPage'>;
  readonly linkedin: LinkedinChannel;
  readonly models: ProcessModels;
  /** Читатели ссылок LinkedIn для `drain` — `createReaders` пакета enricher (П13). */
  readonly readers: readonly Reader[];
};

/** Реестр коннекторов по id (П1). Неизвестный id — `undefined`: вызывающий пропускает источник. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- модели AI SDK и каналы — объекты провайдеров, readonly их не сделать
export function createConnectors(deps: ConnectorDeps): ReadonlyMap<string, Connector> {
  const process = classifyAndExtract(deps.models);
  const options = { readers: deps.readers };
  const connectors = [
    assemble(openTelegram({ telegram: deps.telegram, process }), options),
    assemble(linkedin({ linkedin: deps.linkedin, process }), options),
  ];
  return new Map(connectors.map((connector) => [connector.id, connector]));
}
