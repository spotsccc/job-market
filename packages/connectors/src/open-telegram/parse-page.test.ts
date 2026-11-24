import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, test } from 'node:test';

import { parseChannelPage } from './parse-page.ts';

/** Настоящие страницы `t.me/s/<канал>`, скачанные 20.11.2026, без правок руками. */
async function fixture(name: string): Promise<string> {
  return readFile(path.join(import.meta.dirname, 'fixtures', `${name}.html`), 'utf8');
}

describe('parseChannelPage', () => {
  test('parses vacancy posts with hidden links into Markdown', async () => {
    const page = parseChannelPage(await fixture('forproducts'), 'forproducts');

    assert.ok(!(page instanceof Error), page instanceof Error ? page.message : '');
    assert.equal(page.messages.length, 20);
    assert.deepEqual(
      page.messages.map((message) => message.id),
      Array.from({ length: 20 }, (_, index) => 10_888 + index),
    );

    const last = page.messages.at(-1);
    assert.deepEqual(last, {
      channel: 'forproducts',
      id: 10_907,
      url: 'https://t.me/forproducts/10907',
      content: [
        '**Project Manager**',
        '**OWLCAT GAMES** is a computer game development studio specializing in large-scale isometric RPGs (cRPG).',
        '**Languages:** Russian — B2, English — C1.',
        '**On-site or remote work. Flexible hours.**',
        '[Job description.](https://owlcat.games/careers/296)',
      ].join('\n'),
      postedAt: new Date('2026-11-20T18:52:58+00:00'),
      authorName: 'Job for Products and Projects',
    });
  });

  test('keeps the cross-promo footer as a link to the other channel', async () => {
    const page = parseChannelPage(await fixture('forproducts'), 'forproducts');

    assert.ok(!(page instanceof Error));
    const belka = page.messages.find((message) => message.id === 10_905);
    assert.match(
      belka?.content ?? '',
      /\[Job description\.\]\(https:\/\/job-boards\.eu\.greenhouse\.io\/tripledotstudios\/jobs\/5041110101\)/u,
    );
    assert.match(
      belka?.content ?? '',
      /\*\*Больше вакансий для ТОПов:\*\* https:\/\/t\.me\/forchiefs$/u,
    );
  });

  test('parses photo posts and forwards; decodes the channel title', async () => {
    const page = parseChannelPage(await fixture('geekjobs'), 'geekjobs');

    assert.ok(!(page instanceof Error), page instanceof Error ? page.message : '');
    assert.equal(page.messages.length, 20);
    assert.ok(page.messages.every((message) => message.authorName === 'Job in IT&Digital'));
    const article = page.messages.find((message) => message.id === 10_525);
    assert.match(
      article?.content ?? '',
      /^\*\*Вас собеседует не человек, а ИИ\. Что делать\?\*\*/u,
    );
  });

  test('normalises the channel case from data-post', async () => {
    const html = (await fixture('forallmedia')).replaceAll(
      'data-post="forallmedia/',
      'data-post="ForAllMedia/',
    );

    const page = parseChannelPage(html, 'forallmedia');

    assert.ok(!(page instanceof Error));
    assert.ok(
      page.messages.every((message) => message.url.startsWith('https://t.me/forallmedia/')),
    );
  });

  test('returns an error for a page without message history', () => {
    const page = parseChannelPage(
      '<html><body><div class="tgme_page">If you have Telegram, you can contact @geeksjobs right away.</div></body></html>',
      'geeksjobs',
    );

    assert.ok(page instanceof Error);
    assert.match(page.message, /no message history/u);
  });
});
