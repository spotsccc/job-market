import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { contentHash } from './content-hash.ts';

const VACANCY = [
  '**People Associate – Working Student**',
  '**Wolt** is a company known for its online food and goods delivery service.',
  '[Job description on LinkedIn.](https://de.linkedin.com/jobs/view/4491870331)',
].join('\n');

describe('contentHash', () => {
  test('ignores the cross-promo footer of the channel', () => {
    assert.equal(
      contentHash(`${VACANCY}\n\n**Больше вакансий в HR:** https://t.me/forhr`),
      contentHash(`${VACANCY}\n\n**Больше вакансий для ТОПов:** https://t.me/forchiefs`),
    );
    assert.equal(
      contentHash(`${VACANCY}\nMore jobs: https://t.me/remotegeekjob`),
      contentHash(VACANCY),
    );
  });

  test('ignores whitespace differences', () => {
    assert.equal(contentHash(`  ${VACANCY.replaceAll('\n', '\n\n')}  `), contentHash(VACANCY));
  });

  test('keeps contacts and the vacancy text', () => {
    assert.notEqual(contentHash(`${VACANCY}\nПисать: https://t.me/hr_anna`), contentHash(VACANCY));
    assert.notEqual(contentHash(VACANCY.replace('Wolt', 'Bolt')), contentHash(VACANCY));
  });
});
