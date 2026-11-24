import { log as rootLog } from '@job-market/logger';
import { Alert, Anchor, Container, Group, Stack, Text, Title } from '@mantine/core';
import type { ReactNode } from 'react';

import { loadFilterOptions } from './filter-options.ts';
import { countActiveFilters, parseFilters } from './filters.ts';
import type { SearchParams, VacancyFilters } from './filters.ts';
import { VacancyPagination } from './pagination.tsx';
import { PAGE_SIZE, searchVacancies } from './search-vacancies.ts';
import { VacancyCard } from './vacancy-card.tsx';
import { VacancyFiltersForm } from './vacancy-filters.tsx';

const log = rootLog.with({ module: 'vacancies' });

type VacanciesPageProps = Readonly<{ searchParams: Promise<SearchParams> }>;

function LoadError({ message }: Readonly<{ message: string }>): ReactNode {
  return (
    <Alert color="red" title="Ошибка" role="alert">
      {message}
    </Alert>
  );
}

async function Results({ filters }: Readonly<{ filters: VacancyFilters }>): Promise<ReactNode> {
  const result = await searchVacancies(filters);
  if (result instanceof Error) {
    log.error('Vacancy search failed', { err: result, action: 'searchVacancies', filters });
    return <LoadError message="Не удалось загрузить вакансии" />;
  }
  const filtered = filters.q !== '' || countActiveFilters(filters) > 0;
  if (result.items.length === 0) {
    if (filters.page > 1) {
      return (
        <Text c="dimmed">
          На этой странице вакансий нет. <Anchor href="/vacancies">К началу</Anchor>
        </Text>
      );
    }
    return <Text c="dimmed">{filtered ? 'Ничего не нашлось' : 'В базе пока нет вакансий'}</Text>;
  }
  const pages = Math.ceil(result.total / PAGE_SIZE);
  const first = (filters.page - 1) * PAGE_SIZE + 1;
  return (
    <Stack gap="md">
      <Text c="dimmed">
        {filtered ? 'Найдено' : 'Вакансий в базе'}: {result.total}
        {pages > 1
          ? `, показаны ${String(first)}–${String(first + result.items.length - 1)}`
          : null}
      </Text>
      {result.items.map((vacancy) => (
        <VacancyCard key={vacancy.id} vacancy={vacancy} />
      ))}
      <Group justify="center">
        <VacancyPagination page={filters.page} pages={pages} />
      </Group>
    </Stack>
  );
}

export default async function VacanciesPage({
  searchParams,
}: VacanciesPageProps): Promise<ReactNode> {
  const filters = parseFilters(await searchParams);
  const options = await loadFilterOptions();
  if (options instanceof Error) {
    log.error('Vacancy filter options failed', { err: options, action: 'loadFilterOptions' });
  }

  return (
    <Container component="main" size="xl" py="xl">
      <Title order={1} mb="lg">
        Вакансии
      </Title>
      {options instanceof Error ? (
        <LoadError message="Не удалось загрузить фильтры" />
      ) : (
        // Ключ — фильтры: при переходе по истории поля формы показывают фильтры из адреса.
        <VacancyFiltersForm key={JSON.stringify(filters)} filters={filters} options={options}>
          <Results filters={filters} />
        </VacancyFiltersForm>
      )}
    </Container>
  );
}
