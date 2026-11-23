import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, describe, test } from 'node:test';

import { db, getDb } from '../client.ts';
import { listOccupations } from './occupation.ts';
import type { Occupation } from './occupation.ts';

/** Тесты идут в тестовую базу из `apps/web/.env.test`: `pnpm db:up && pnpm db:migrate:test`. */

type SnapshotNode = {
  readonly id: string;
  readonly parent_id: string | null;
  readonly name: string;
  readonly description: string;
};

/** Снимок дерева, по которому размечен набор проверки экстрактора: миграция вставляет его же. */
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- файл данных репозитория, его форму проверяет набор
const snapshot = JSON.parse(
  readFileSync(new URL('../../../extractor/eval/occupations.json', import.meta.url), 'utf8'),
) as readonly SnapshotNode[];

function depthUnderRoot(tree: readonly Occupation[], node: Occupation): number {
  const parent = tree.find((other) => other.id === node.parentId);
  return parent === undefined || parent.id === 'root' ? 1 : 1 + depthUnderRoot(tree, parent);
}

describe('occupation tree', () => {
  after(async () => {
    await getDb().$client.end();
  });

  test('the tree after migrations equals the snapshot of the eval set', async () => {
    const tree = await listOccupations(db);

    assert.deepEqual(
      tree
        .map(({ id, parentId, name, description }) => ({
          id,
          parent_id: parentId,
          name,
          description,
        }))
        .toSorted((a, b) => a.id.localeCompare(b.id)),
      [...snapshot].toSorted((a, b) => a.id.localeCompare(b.id)),
    );
  });

  test('every node under root has a description and is at most three levels deep', async () => {
    const tree = await listOccupations(db);

    for (const node of tree.filter((other) => other.id !== 'root')) {
      assert.notEqual(node.description.trim(), '', node.id);
      assert.ok(depthUnderRoot(tree, node) <= 3, node.id);
    }
  });
});
