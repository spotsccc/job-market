import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { htmlToMarkdown } from './html-to-markdown.ts';

describe('htmlToMarkdown', () => {
  test('keeps link targets hidden behind text', () => {
    assert.equal(
      htmlToMarkdown(
        '<a href="https://owlcat.games/careers/296" target="_blank" rel="noopener" onclick="return confirm(\'Open this link?\\n\\n\'+this.href);">Job description.</a>',
      ),
      '[Job description.](https://owlcat.games/careers/296)',
    );
  });

  test('turns emoji markup into the emoji, not into bold text', () => {
    assert.equal(
      htmlToMarkdown(
        '<i class="emoji" style="background-image:url(\'//telegram.org/img/emoji/40/F09F94B9.png\')"><b>🔹</b></i>&nbsp;VP, Head of Product',
      ),
      '🔹 VP, Head of Product',
    );
  });

  test('converts formatting, line breaks and entities', () => {
    assert.equal(
      htmlToMarkdown(
        '<b>Product Director</b><br/><b>Belka Games</b> &amp; co<br/><br/><br/><i>Hybrid</i>',
      ),
      '**Product Director**\n**Belka Games** & co\n\n_Hybrid_',
    );
  });

  test('moves spaces out of markers', () => {
    assert.equal(htmlToMarkdown('<b> «Собес» </b>— подкаст'), '**«Собес»** — подкаст');
  });

  test('drops relative hashtag links and keeps channel mentions as urls', () => {
    assert.equal(
      htmlToMarkdown(
        '<a href="?q=%23%D0%BF%D0%BE%D0%B4%D0%BA%D0%B0%D1%81%D1%82">#подкаст</a> <a href="https://t.me/forchiefs" target="_blank">@forchiefs</a>',
      ),
      '#подкаст https://t.me/forchiefs',
    );
  });
});
