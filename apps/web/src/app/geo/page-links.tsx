'use client';

import { Pagination } from '@mantine/core';
import { useCallback } from 'react';
import type { ReactNode } from 'react';

type PageLinksProps = Readonly<{
  /** Текущая страница, с 1. */
  page: number;
  total: number;
  /** Прочие параметры адреса без `page`, уже закодированные: `city=бер`. */
  query: string;
}>;

type Control = 'first' | 'previous' | 'next' | 'last';

/** Пагинация ссылками: страница живёт в адресе, её можно открыть в новой вкладке. */
export function PageLinks({ page, total, query }: PageLinksProps): ReactNode {
  const href = useCallback(
    (target: number): string => {
      const search = new URLSearchParams(query);
      if (target > 1) search.set('page', String(target));
      return `?${search.toString()}`;
    },
    [query],
  );
  const itemProps = useCallback(
    (target: number) => ({ component: 'a', href: href(target) }),
    [href],
  );
  const controlProps = useCallback(
    (control: Control) => {
      const targets = {
        first: 1,
        previous: Math.max(1, page - 1),
        next: Math.min(total, page + 1),
        last: total,
      };
      return { component: 'a', href: href(targets[control]) };
    },
    [href, page, total],
  );

  return (
    <Pagination
      total={total}
      value={page}
      withEdges
      getItemProps={itemProps}
      getControlProps={controlProps}
    />
  );
}
