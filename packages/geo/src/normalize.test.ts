import assert from 'node:assert/strict';
import { test } from 'node:test';

import { normalizeName } from './normalize.ts';

test('дефис — пробел, регистр нижний', () => {
  assert.equal(normalizeName('Санкт-Петербург'), 'санкт петербург');
});

test('диакритика снимается', () => {
  assert.equal(normalizeName('München'), 'munchen');
});

test('ß и ẞ — ss', () => {
  assert.equal(normalizeName('Straße'), 'strasse');
  assert.equal(normalizeName('STRAẞE'), 'strasse');
});

test('ё — е', () => {
  assert.equal(normalizeName('Ёлки'), 'елки');
});

test('«й» и «и» совпадают: NFKD снимает краткую', () => {
  assert.equal(normalizeName('Буэнос-Айрес'), normalizeName('Буэнос Аирес'));
  assert.equal(normalizeName('Буэнос-Айрес'), 'буэнос аирес');
});

test('точки и лишние пробелы убираются', () => {
  assert.equal(normalizeName('  St. Petersburg '), 'st petersburg');
});

test('строка без букв и цифр — пустая', () => {
  assert.equal(normalizeName('---'), '');
});

test('цифры остаются', () => {
  assert.equal(normalizeName('Paris 15e'), 'paris 15e');
});
