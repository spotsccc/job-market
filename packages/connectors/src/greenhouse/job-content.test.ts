import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import { parseBoard } from './channel.ts';
import { greenhouseJob } from './fake-greenhouse.test-utils.ts';
import { jobContent } from './job-content.ts';

/** HTML, записанный сущностями, как его отдаёт Greenhouse. */
const encoded = (html: string): string =>
  html.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

const content = (html: string): string =>
  jobContent(greenhouseJob({ content: encoded(html), location: null, departments: [] }));

describe('jobContent', () => {
  test('a real Wrike job starts with the title, location and departments', () => {
    const fixture: unknown = JSON.parse(
      readFileSync(new URL('fixtures/wrike-job.json', import.meta.url), 'utf8'),
    );
    const jobs = parseBoard({ jobs: [fixture] });
    assert.ok(!(jobs instanceof Error), jobs instanceof Error ? String(jobs.cause) : '');
    const [job] = jobs;
    assert.ok(job !== undefined);

    const lines = jobContent(job).split('\n');

    assert.deepEqual(lines.slice(0, 4), [
      '# Account Development Manager 1 -Evening shift (15:30 - 00:00)',
      'Локация: Prague',
      'Отделы: 3210 Expand EMEA',
      '',
    ]);
    assert.ok(lines.includes('## About the Role:'));
    assert.ok(!lines.some((line) => /[<>]|&#39;|&nbsp;/u.test(line)));
  });

  test('headings and list items become Markdown, bold stays', () => {
    assert.equal(
      content('<h2>About</h2><ul><li><strong>Go</strong> 3+</li></ul>'),
      '# Account Development Manager\n\n## About\n\n- **Go** 3+',
    );
  });

  test('two paragraphs are split by one empty line', () => {
    assert.equal(
      content('<p>First</p>\n<p>Second</p>'),
      '# Account Development Manager\n\nFirst\n\nSecond',
    );
  });

  test('a link keeps its address', () => {
    assert.equal(
      content('<p>Apply <a href="https://wrike.com/careers" target="_blank">here</a></p>'),
      '# Account Development Manager\n\nApply [here](https://wrike.com/careers)',
    );
  });

  test('an entity inside the encoded HTML is decoded once more', () => {
    assert.equal(
      content('<p>We&#39;re hiring</p>'),
      "# Account Development Manager\n\nWe're hiring",
    );
  });

  test('div, span and img are removed, their text stays', () => {
    assert.equal(
      content('<div class="intro"><span>Remote</span><img src="https://x/y.png"> first</div>'),
      '# Account Development Manager\n\nRemote first',
    );
  });
});
