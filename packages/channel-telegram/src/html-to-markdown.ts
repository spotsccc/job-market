/**
 * Текст сообщения из веб-превью `t.me/s/…` в Markdown. Разметка там узкая и
 * предсказуемая: `<b>`, `<i>`, `<u>`, `<s>`, `<code>`, `<pre>`, `<a>`, `<br/>`,
 * `<blockquote>`, эмодзи и спойлеры. Ссылки важнее всего: в постах-вакансиях адрес
 * отклика спрятан за текстом «Job description.», и без Markdown он теряется.
 */

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

export function decodeEntities(text: string): string {
  return text.replaceAll(/&(#x[\da-f]+|#\d+|[a-z]+);/giu, (entity: string, code: string) => {
    if (code.startsWith('#x') || code.startsWith('#X')) {
      return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
    }
    if (code.startsWith('#')) return String.fromCodePoint(Math.trunc(Number(code.slice(1))));
    return NAMED_ENTITIES[code.toLowerCase()] ?? entity;
  });
}

function stripTags(html: string): string {
  return html.replaceAll(/<[^>]*>/gu, '');
}

/** `//telegram.org/x` → `https://telegram.org/x`. Относительные (`?q=%23тег`) — не ссылки, `null`. */
function absoluteUrl(href: string): string | null {
  const url = decodeEntities(href);
  if (url.startsWith('//')) return `https:${url}`;
  if (/^https?:\/\//iu.test(url)) return url;
  return null;
}

function link(href: string, inner: string): string {
  const text = decodeEntities(stripTags(inner)).trim();
  const url = absoluteUrl(href);
  if (url === null) return text;
  // Голый адрес или `@канал` со ссылкой на него — оставляем адрес, `[x](x)` только шумит.
  if (text === '' || text === url || url.endsWith(`/${text.replace(/^@/u, '')}`)) return url;
  return `[${text}](${url})`;
}

/** Пробелы по краям выносим за маркеры: `** Собес **` Markdown не считает жирным. */
function wrap(marker: string, inner: string): string {
  const match = /^(\s*)(.*?)(\s*)$/su.exec(inner);
  const [, before = '', body = '', after = ''] = match ?? [];
  return body === '' ? inner : `${before}${marker}${body}${marker}${after}`;
}

const INLINE_MARKERS: Readonly<Record<string, string>> = {
  b: '**',
  strong: '**',
  i: '_',
  em: '_',
  s: '~~',
  del: '~~',
  code: '`',
};

export function htmlToMarkdown(html: string): string {
  let text = html
    // Эмодзи: `<i class="emoji" …><b>🔹</b></i>` — берём сам символ, `<b>` внутри не жирный текст.
    .replaceAll(/<i class="emoji"[^>]*>(.*?)<\/i>/gsu, (_match, inner: string) => stripTags(inner))
    .replaceAll(
      /<a\s[^>]*?href="([^"]*)"[^>]*>(.*?)<\/a>/gsu,
      (_match, href: string, inner: string) => link(href, inner),
    )
    .replaceAll(/<br\s*\/?>/gu, '\n')
    .replaceAll(
      /<pre[^>]*>(.*?)<\/pre>/gsu,
      (_match, inner: string) => `\n\`\`\`\n${inner}\n\`\`\`\n`,
    )
    .replaceAll(
      /<blockquote[^>]*>(.*?)<\/blockquote>/gsu,
      (_match, inner: string) => `\n${inner}\n`,
    );

  // Вложенность бывает (`<b><i>…</i></b>`), поэтому повторяем, пока что-то меняется.
  for (let previous = ''; previous !== text;) {
    previous = text;
    text = text.replaceAll(
      /<(b|strong|i|em|s|del|code)>((?:(?!<\/?\1>).)*)<\/\1>/gsu,
      (_match, tag: string, inner: string) => wrap(INLINE_MARKERS[tag] ?? '', inner),
    );
  }

  return decodeEntities(stripTags(text))
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replaceAll(/\n{3,}/gu, '\n\n')
    .trim();
}
