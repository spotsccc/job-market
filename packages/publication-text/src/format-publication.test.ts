import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { formatPublication } from './format-publication.ts';
import type { PublicationForModel } from './format-publication.ts';

function publication(overrides: Partial<PublicationForModel> = {}): PublicationForModel {
  return {
    connector: 'open-telegram',
    content: 'Ищем Product Manager в Acme',
    postedAt: new Date('2026-11-20T10:00:00Z'),
    author: {
      name: 'Job for Products and Projects',
      url: 'https://t.me/forproducts',
      headline: null,
    },
    ...overrides,
  };
}

describe('formatPublication', () => {
  test('labels a Telegram channel post and leaves out a missing headline', () => {
    const text = formatPublication(publication());

    assert.match(text, /^Источник: Telegram-канал$/mu);
    assert.match(text, /^Автор: Job for Products and Projects$/mu);
    assert.doesNotMatch(text, /Подпись автора/u);
    assert.match(text, /^Опубликован: 2026-11-20T10:00:00\.000Z$/mu);
    assert.match(text, /^<post>\n[\s\S]*\nИщем Product Manager в Acme\n<\/post>$/u);
  });

  test('labels a LinkedIn post and shows the author headline', () => {
    const text = formatPublication(
      publication({
        connector: 'linkedin',
        author: {
          name: 'Jane Doe',
          url: 'https://www.linkedin.com/in/jane',
          headline: 'Hiring at Acme',
        },
      }),
    );

    assert.match(text, /^Источник: LinkedIn$/mu);
    assert.match(text, /^Подпись автора: Hiring at Acme$/mu);
    assert.match(text, /^Ссылка на автора: https:\/\/www\.linkedin\.com\/in\/jane$/mu);
  });

  test('has no author lines when the publication has no author', () => {
    const text = formatPublication(publication({ author: null }));

    assert.doesNotMatch(text, /Автор|Подпись автора|Ссылка на автора/u);
    assert.match(text, /^Опубликован: /mu);
  });
});
