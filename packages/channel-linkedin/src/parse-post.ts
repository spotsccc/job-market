/** Пост LinkedIn из датасета `harvestapi/linkedin-post-search`, только нужные нам поля. */
export type LinkedinPost = {
  /** Числовой id активности LinkedIn строкой: `7330988768578920448`. */
  readonly id: string;
  readonly url: string;
  /** Текст поста. Пустая строка, если текста нет: репост или пост из одних картинок. */
  readonly content: string;
  readonly postedAt: Date;
  readonly author: LinkedinPostAuthor;
};

export type LinkedinPostAuthor = {
  readonly name: string;
  /** Ссылка на профиль человека или страницу компании. */
  readonly url: string;
  /** Заголовок профиля: должность и компания. */
  readonly headline: string | null;
  /** Часть ссылки профиля после `/in/`. У компаний её нет. */
  readonly publicIdentifier: string | null;
};

type UnknownRecord = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function parsePostedAt(value: unknown): Error | Date {
  if (!isRecord(value)) return new Error('Expected postedAt to be an object');
  const { timestamp, date } = value;
  if (typeof timestamp === 'number') return new Date(timestamp);
  if (typeof date === 'string') {
    const parsed = new Date(date);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Error('Expected postedAt.timestamp or a valid postedAt.date');
}

function parseAuthor(value: unknown): Error | LinkedinPostAuthor {
  if (!isRecord(value)) return new Error('Expected author to be an object');
  const { name, linkedinUrl, info, publicIdentifier } = value;
  if (typeof name !== 'string') return new Error('Expected author.name to be a string');
  if (typeof linkedinUrl !== 'string') {
    return new Error('Expected author.linkedinUrl to be a string');
  }
  return {
    name,
    url: linkedinUrl,
    headline: optionalString(info),
    publicIdentifier: optionalString(publicIdentifier),
  };
}

/**
 * Разбирает элемент датасета. `null` — элемент не пост (реакция или комментарий),
 * его пропускаем. Требует только поля, которые мы читаем: лишние и `null` в
 * необязательных не ломают разбор.
 */
export function parsePost(item: unknown): Error | LinkedinPost | null {
  if (!isRecord(item)) return new Error('Expected item to be an object');
  if (item['type'] !== undefined && item['type'] !== 'post') return null;

  const { id, linkedinUrl, content } = item;
  if (typeof id !== 'string') return new Error('Expected id to be a string');
  if (typeof linkedinUrl !== 'string') return new Error('Expected linkedinUrl to be a string');

  const author = parseAuthor(item['author']);
  if (author instanceof Error) return author;

  const postedAt = parsePostedAt(item['postedAt']);
  if (postedAt instanceof Error) return postedAt;

  return {
    id,
    url: linkedinUrl,
    content: typeof content === 'string' ? content : '',
    postedAt,
    author,
  };
}
