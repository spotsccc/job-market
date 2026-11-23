import assert from 'node:assert/strict';
import { test } from 'node:test';

import { skipReason } from './skip-reason.ts';

test('a text without characters is empty', () => {
  assert.equal(skipReason(''), 'empty');
  assert.equal(skipReason('  \n'), 'empty');
});

test('a text without letters has no words', () => {
  assert.equal(skipReason('🔥🔥🔥'), 'no_words');
  assert.equal(skipReason('+'), 'no_words');
  assert.equal(skipReason('👇 2026'), 'no_words');
});

test('a text with letters is processed, even a bare link', () => {
  assert.equal(skipReason('https://lnkd.in/abc'), undefined);
  assert.equal(skipReason('Ищем Go-разработчика @hr_anna'), undefined);
});
