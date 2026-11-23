import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { formatSection, MAX_SECTION_LENGTH, sectionUrls, stripSections } from './section.ts';

const JOB_URL = 'https://www.linkedin.com/jobs/view/4479627327/';
const POST_URL = 'https://www.linkedin.com/feed/update/urn:li:activity:7302346926123798528';

describe('formatSection', () => {
  test('puts a blank line, the header and the body', () => {
    assert.equal(
      formatSection('Вакансия LinkedIn', JOB_URL, 'Senior Frontend · Acme'),
      `\n\n--- Вакансия LinkedIn по ссылке ${JOB_URL}\nSenior Frontend · Acme`,
    );
  });

  test('cuts the section with its header to the limit', () => {
    const section = formatSection('Вакансия LinkedIn', JOB_URL, 'x'.repeat(9000));

    assert.ok(section.startsWith(`\n\n--- Вакансия LinkedIn по ссылке ${JOB_URL}\nxxx`));
    assert.equal(section.length, 2 + MAX_SECTION_LENGTH);
  });
});

describe('sectionUrls and stripSections', () => {
  const text =
    `Ищем людей ${JOB_URL} и ${POST_URL}` +
    formatSection('Вакансия LinkedIn', JOB_URL, 'Описание со ссылкой https://example.com/x') +
    formatSection('Пост LinkedIn', POST_URL, 'Текст поста');

  test('finds the url of every appended section', () => {
    assert.deepEqual([...sectionUrls(text)], [JOB_URL, POST_URL]);
  });

  test('returns the text before the first section', () => {
    assert.equal(stripSections(text), `Ищем людей ${JOB_URL} и ${POST_URL}`);
    assert.equal(stripSections('Без разделов'), 'Без разделов');
  });
});
