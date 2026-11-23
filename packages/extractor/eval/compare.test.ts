import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { compareCase } from './compare.ts';
import type { ActualRole, ExpectedRole, TreeNode } from './compare.ts';
import { summarize } from './summary.ts';

const tree: readonly TreeNode[] = [
  { id: 'root', parent_id: null },
  { id: 'it', parent_id: 'root' },
  { id: 'engineering', parent_id: 'it' },
  { id: 'frontend', parent_id: 'engineering' },
  { id: 'backend', parent_id: 'engineering' },
];

function compareRole(expected: ExpectedRole, actual: ActualRole) {
  const comparison = compareCase(tree, [expected], [actual]);
  return { role: comparison.roles[0] ?? {}, summary: summarize([comparison]) };
}

function drift(expected: string, actual: string) {
  const result = compareRole({ occupationId: expected }, { occupationId: actual }).role
    .occupationId;
  return result?.kind === 'occupation' ? result.drift : undefined;
}

describe('compareCase', () => {
  test('sets are compared without case, with precision and recall', () => {
    const { summary } = compareRole(
      { skills: ['React', 'TypeScript'] },
      { skills: ['react', 'Vue'] },
    );

    const { skills } = summary.fields;
    assert.ok(skills !== undefined);
    assert.equal(skills.precision, 0.5);
    assert.equal(skills.recall, 0.5);
  });

  test('two empty sets match', () => {
    const { role } = compareRole({ niceSkills: [] }, { niceSkills: [] });

    assert.equal(role.niceSkills?.match, true);
  });

  test('different enum values do not match, null matches null', () => {
    const { role } = compareRole(
      { seniority: 'senior', salaryMin: null },
      { seniority: 'middle', salaryMin: null },
    );

    assert.equal(role.seniority?.match, false);
    assert.equal(role.salaryMin?.match, true);
  });

  test('a field missing from the answer is skipped', () => {
    const { role } = compareRole(
      { occupationId: 'frontend', title: 'Frontend' },
      { title: 'frontend ' },
    );

    assert.equal(role.occupationId, undefined);
    assert.equal(role.title?.match, true);
  });

  test('a different number of roles does not match', () => {
    const comparison = compareCase(tree, [{ title: 'A' }, { title: 'B' }], [{ title: 'A' }]);

    assert.equal(comparison.roleCount.match, false);
    assert.equal(comparison.roles.length, 1);
  });

  test('a language with another level does not match', () => {
    const { role } = compareRole(
      { languages: [{ code: 'en', level: 'B2' }] },
      { languages: [{ code: 'en', level: 'C1' }] },
    );

    assert.equal(role.languages?.match, false);
  });

  test('places are pairs of role and place key', () => {
    const { summary } = compareRole(
      {
        places: [
          { role: 'hiring', key: 'region:eu' },
          { role: 'office', key: 'city:2950159' },
        ],
      },
      { places: [{ role: 'hiring', key: 'region:eu' }] },
    );

    const { places } = summary.fields;
    assert.ok(places !== undefined);
    assert.equal(places.precision, 1);
    assert.equal(places.recall, 0.5);
  });

  test('sections compare only whether they are empty', () => {
    const { role } = compareRole(
      { responsibilities: false },
      { responsibilities: ['Писать тесты'] },
    );

    assert.equal(role.responsibilities?.match, false);
  });

  test('an occupation mismatch tells where the answer drifted', () => {
    assert.equal(drift('frontend', 'engineering'), 'ancestor');
    assert.equal(drift('engineering', 'frontend'), 'descendant');
    assert.equal(drift('frontend', 'backend'), 'other_branch');
  });
});
