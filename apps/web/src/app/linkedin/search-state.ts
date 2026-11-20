/** Пост для клиента: только сериализуемые поля, дата строкой ISO. */
export type PostView = {
  readonly id: string;
  readonly url: string;
  readonly content: string;
  readonly postedAt: string;
  readonly authorName: string;
  readonly authorUrl: string;
  readonly authorHeadline: string | null;
};

export type SearchState =
  | { readonly status: 'idle' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ok'; readonly posts: readonly PostView[]; readonly elapsedMs: number };

export const INITIAL_SEARCH_STATE: SearchState = { status: 'idle' };

export const POSTED_LIMITS = ['1h', '24h', 'week', 'month'] as const;
export const SORT_OPTIONS = ['relevance', 'date'] as const;

/** Потолок на запрос в форме: за каждый пост Apify берёт деньги. */
export const MAX_POSTS_LIMIT = 100;
