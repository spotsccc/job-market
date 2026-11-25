/** Фейки для тестов тех, кто зовёт коннекторы: движка и самих коннекторов. */
export { fakeTelegram, telegramMessage } from './open-telegram/fake-telegram.test-utils.ts';
export type {
  FakeTelegram,
  FakeTelegramOptions,
} from './open-telegram/fake-telegram.test-utils.ts';
export { fakeGreenhouse, greenhouseJob } from './greenhouse/fake-greenhouse.test-utils.ts';
export type {
  FakeGreenhouse,
  FakeGreenhouseOptions,
} from './greenhouse/fake-greenhouse.test-utils.ts';
export { extractedRole } from './models.test-utils.ts';
export { testConnector } from './test-connector.test-utils.ts';
export type { TestConnectorParts } from './test-connector.test-utils.ts';
