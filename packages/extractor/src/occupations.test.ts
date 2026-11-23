import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { ancestors, occupationEnum, occupationsPrompt } from './occupations.ts';
import type { OccupationNode } from './occupations.ts';

const node = (id: string, parentId: string | null, archived = false): OccupationNode => ({
  id,
  parentId,
  name: id,
  description: `Узел ${id}.`,
  archived,
});

const TREE: readonly OccupationNode[] = [
  node('root', null),
  node('it', 'root'),
  node('engineering', 'it'),
  node('frontend', 'engineering'),
  node('backend', 'engineering'),
  node('design', 'root'),
];

describe('occupation tree', () => {
  test('the enum follows the tree path whatever the order of rows (E4)', () => {
    const expected = ['root', 'design', 'it', 'engineering', 'backend', 'frontend'];

    assert.deepEqual(occupationEnum(TREE), expected);
    assert.deepEqual(occupationEnum(TREE.toReversed()), expected);
  });

  test('an archived node and its subtree are not in the enum', () => {
    const tree = TREE.map((item) =>
      item.id === 'engineering' ? node('engineering', 'it', true) : item,
    );

    assert.deepEqual(occupationEnum(tree), ['root', 'design', 'it']);
  });

  test('ancestors go from the parent to root', () => {
    assert.deepEqual(ancestors(TREE, 'frontend'), ['engineering', 'it', 'root']);
  });

  test('prompt lines are paths without root with descriptions', () => {
    assert.match(occupationsPrompt(TREE), /^it › engineering › frontend — Узел frontend\.$/mu);
    assert.match(occupationsPrompt(TREE), /^root — Узел root\.$/mu);
  });
});
