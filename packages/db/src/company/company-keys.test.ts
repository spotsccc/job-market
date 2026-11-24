import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { keyOfUrl, keysOf, normalizeName } from './company-keys.ts';

describe('normalizeName', () => {
  test('drops the legal form and the quotes', () => {
    assert.equal(normalizeName('ООО "Яндекс"'), 'яндекс');
    assert.equal(normalizeName('ООО «Яндекс»'), 'яндекс');
  });

  test('drops the trailing legal form with its punctuation', () => {
    assert.equal(normalizeName('Acme, Inc.'), 'acme');
  });

  test('replaces ё, lowercases and collapses spaces', () => {
    assert.equal(normalizeName('  Ёлка   Групп '), 'елка групп');
  });

  test('a legal form alone gives no key', () => {
    assert.equal(normalizeName('ООО'), null);
  });

  test('a legal form inside a word stays', () => {
    assert.equal(normalizeName('Cobalt'), 'cobalt');
    assert.equal(normalizeName('Аозис'), 'аозис');
  });
});

describe('keyOfUrl', () => {
  test('a careers subdomain gives the registrable domain', () => {
    assert.deepEqual(keyOfUrl('https://careers.yandex.ru/jobs/1'), {
      kind: 'domain',
      value: 'yandex.ru',
    });
  });

  test('a LinkedIn company page gives the lowercased slug', () => {
    assert.deepEqual(keyOfUrl('https://www.Linkedin.com/company/Acme/about/'), {
      kind: 'linkedin',
      value: 'company/acme',
    });
  });

  test('another LinkedIn page gives no key', () => {
    assert.equal(keyOfUrl('https://www.linkedin.com/in/jane-doe'), null);
  });

  test('aggregators and messengers give no key', () => {
    assert.equal(keyOfUrl('https://hh.ru/employer/1740'), null);
    assert.equal(keyOfUrl('https://t.me/forhr'), null);
    assert.equal(keyOfUrl('https://acme.notion.site/jobs'), null);
  });

  test('a two-part public suffix stays with the domain', () => {
    assert.deepEqual(keyOfUrl('https://careers.acme.co.uk'), {
      kind: 'domain',
      value: 'acme.co.uk',
    });
  });

  test('a national domain is keyed in punycode', () => {
    assert.deepEqual(keyOfUrl('https://яндекс.рф'), {
      kind: 'domain',
      value: 'xn--d1acpjx3f.xn--p1ai',
    });
  });

  test('a link without a scheme is read as https', () => {
    assert.deepEqual(keyOfUrl('yandex.ru/jobs'), { kind: 'domain', value: 'yandex.ru' });
  });

  test('an IP address, localhost and text give no key', () => {
    assert.equal(keyOfUrl('http://192.168.0.1'), null);
    assert.equal(keyOfUrl('http://localhost:3000'), null);
    assert.equal(keyOfUrl('не ссылка'), null);
  });
});

describe('keysOf', () => {
  test('the domain goes before the name', () => {
    assert.deepEqual(keysOf('Yandex', 'https://yandex.ru'), [
      { kind: 'domain', value: 'yandex.ru' },
      { kind: 'name', value: 'yandex' },
    ]);
  });

  test('no company and no link give no keys', () => {
    assert.deepEqual(keysOf(null, null), []);
    assert.deepEqual(keysOf('ООО', 'https://t.me/forhr'), []);
  });
});
