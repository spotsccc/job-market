import { log as rootLog } from '@job-market/logger';
import {
  Alert,
  Anchor,
  CloseButton,
  Container,
  Group,
  Pill,
  Stack,
  Text,
  Title,
} from '@mantine/core';
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

/** Адрес страницы с теми же фильтрами, но без компании и номера страницы. */
function withoutCompany(params: SearchParams): string {
  const rest = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    if (name === 'company' || name === 'page' || value === undefined) continue;
    for (const item of typeof value === 'string' ? [value] : value) rest.append(name, item);
  }
  const query = rest.toString();
  return query === '' ? '/vacancies' : `/vacancies?${query}`;
}

/**
 * Чип фильтра компании (П9, packages/db/src/company/README.md): название или «не найдена» и ссылка
 * снятия.
 */
function CompanyChip({
  name,
  removeHref,
}: Readonly<{ name: string | null; removeHref: string }>): ReactNode {
  return (
    <Group gap="xs">
      <Pill size="lg">{name === null ? 'Компания не найдена' : `Компания: ${name}`}</Pill>
      <CloseButton component="a" href={removeHref} aria-label="Снять фильтр компании" />
    </Group>
  );
}

type ResultsProps = Readonly<{ filters: VacancyFilters; params: SearchParams }>;

async function Results({ filters, params }: ResultsProps): Promise<ReactNode> {
  const result = await searchVacancies(filters);
  if (result instanceof Error) {
    log.error('Vacancy search failed', { err: result, action: 'searchVacancies', filters });
    return <LoadError message="Не удалось загрузить вакансии" />;
  }
  const filtered = filters.q !== '' || countActiveFilters(filters) > 0;
  const chip =
    filters.companyId === null ? null : (
      <CompanyChip name={result.company?.name ?? null} removeHref={withoutCompany(params)} />
    );
  // Неизвестная компания: чипа «Компания не найдена» достаточно.
  const unknownCompany = filters.companyId !== null && result.company === null;
  if (result.items.length === 0) {
    return (
      <Stack gap="md">
        {chip}
        {filters.page > 1 ? (
          <Text c="dimmed">
            На этой странице вакансий нет. <Anchor href="/vacancies">К началу</Anchor>
          </Text>
        ) : unknownCompany ? null : (
          <Text c="dimmed">{filtered ? 'Ничего не нашлось' : 'В базе пока нет вакансий'}</Text>
        )}
      </Stack>
    );
  }
  const pages = Math.ceil(result.total / PAGE_SIZE);
  const first = (filters.page - 1) * PAGE_SIZE + 1;
  return (
    <Stack gap="md">
      {chip}
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
  const params = await searchParams;
  const filters = parseFilters(params);
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
          <Results filters={filters} params={params} />
        </VacancyFiltersForm>
      )}
    </Container>
  );
}
