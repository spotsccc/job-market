'use client';

import { Pagination } from '@mantine/core';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import type { ReactNode } from 'react';

/** Страницы выдачи /vacancies: номер страницы — параметр `page` в адресе, остальные фильтры сохраняются. */
export function VacancyPagination({
  page,
  pages,
}: Readonly<{ page: number; pages: number }>): ReactNode {
  const router = useRouter();
  const searchParams = useSearchParams();

  const go = useCallback(
    (next: number): void => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === 1) params.delete('page');
      else params.set('page', String(next));
      const query = params.toString();
      router.push(query === '' ? '/vacancies' : `/vacancies?${query}`);
    },
    [router, searchParams],
  );

  return <Pagination total={pages} value={page} onChange={go} hideWithOnePage />;
}
