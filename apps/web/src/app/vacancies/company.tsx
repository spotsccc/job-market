import { Anchor, Group, Text } from '@mantine/core';
import type { ReactNode } from 'react';

import type { VacancySearchItem } from './search-vacancies.ts';

/** Хост ссылки для подписи; не ссылка — как есть. */
export function hostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * Компания: из справочника — ссылка на все её вакансии, без него — текст как в вакансии
 * (П9, packages/db/src/company/README.md); рядом — ссылка на сайт компании, если он есть.
 */
export function Company({
  vacancy,
  size = 'md',
}: Readonly<{ vacancy: VacancySearchItem }> & Readonly<{ size?: 'md' | 'lg' }>): ReactNode {
  const name = vacancy.companyName ?? vacancy.company;
  if (name === null) return null;
  return (
    <Group gap="xs">
      {vacancy.companyId === null ? (
        <Text fw={500} size={size}>
          {name}
        </Text>
      ) : (
        <Anchor href={`/vacancies?company=${vacancy.companyId}`} fw={500} size={size}>
          {name}
        </Anchor>
      )}
      {vacancy.companyUrl === null ? null : (
        <Anchor href={vacancy.companyUrl} target="_blank" rel="noreferrer" size="sm" c="dimmed">
          {hostname(vacancy.companyUrl)}
        </Anchor>
      )}
    </Group>
  );
}
