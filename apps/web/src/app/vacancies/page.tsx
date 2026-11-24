import { log as rootLog } from '@job-market/logger';
import {
  Alert,
  Button,
  CloseButton,
  Container,
  Group,
  Pill,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import type { ReactNode } from 'react';

import { searchVacancies } from './search-vacancies.ts';
import { VacancyCard } from './vacancy-card.tsx';

const log = rootLog.with({ module: 'vacancies', action: 'searchVacancies' });

type VacanciesPageProps = Readonly<{
  searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}>;

const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/iu;

/** Адрес страницы с этим запросом и без фильтра компании. */
function withoutCompany(query: string): string {
  return query === '' ? '/vacancies' : `/vacancies?${new URLSearchParams({ q: query }).toString()}`;
}

/** Чип фильтра компании (П9 плана компаний): название или «не найдена» и ссылка снятия. */
function CompanyChip({ query, name }: Readonly<{ query: string; name: string | null }>): ReactNode {
  return (
    <Group gap="xs">
      <Pill size="lg">{name === null ? 'Компания не найдена' : `Компания: ${name}`}</Pill>
      <CloseButton component="a" href={withoutCompany(query)} aria-label="Снять фильтр компании" />
    </Group>
  );
}

type ResultsProps = Readonly<{ query: string; companyParam: string | null }>;

async function Results({ query, companyParam }: ResultsProps): Promise<ReactNode> {
  // Не uuid — компании точно нет, а Postgres на таком id бросил бы ошибку (E8).
  if (companyParam !== null && !UUID.test(companyParam)) {
    return <CompanyChip query={query} name={null} />;
  }
  const result = await searchVacancies(
    query,
    companyParam === null ? {} : { companyId: companyParam },
  );
  if (result instanceof Error) {
    log.error('Vacancy search failed', { err: result, query, companyId: companyParam });
    return (
      <Alert color="red" title="Ошибка" role="alert">
        Не удалось загрузить вакансии
      </Alert>
    );
  }
  const chip =
    companyParam === null ? null : (
      <CompanyChip query={query} name={result.company?.name ?? null} />
    );
  if (result.total === 0) {
    return (
      <Stack gap="md">
        {chip}
        {result.company === null && companyParam !== null ? null : (
          <Text c="dimmed">
            {query === '' && companyParam === null
              ? 'В базе пока нет вакансий'
              : 'Ничего не нашлось'}
          </Text>
        )}
      </Stack>
    );
  }
  return (
    <Stack gap="md">
      {chip}
      <Text c="dimmed">
        {query === '' && companyParam === null ? 'Вакансий в базе' : 'Найдено'}: {result.total}
        {result.total > result.items.length
          ? `, показаны первые ${String(result.items.length)}`
          : null}
      </Text>
      {result.items.map((vacancy) => (
        <VacancyCard key={vacancy.id} vacancy={vacancy} />
      ))}
    </Stack>
  );
}

export default async function VacanciesPage({
  searchParams,
}: VacanciesPageProps): Promise<ReactNode> {
  const { q, company } = await searchParams;
  const query = (typeof q === 'string' ? q : '').trim();
  const companyParam = typeof company === 'string' && company !== '' ? company : null;

  return (
    <Container component="main" size="md" py="xl">
      <Title order={1} mb="lg">
        Вакансии
      </Title>
      <Stack gap="xl">
        {/* GET-форма: запрос живёт в адресе страницы, его можно сохранить и переслать. */}
        <search>
          <form action="/vacancies" method="get">
            <Group gap="sm" align="flex-end">
              <TextInput
                name="q"
                type="search"
                label="Поиск"
                placeholder='react удалённо, "senior backend", go -java'
                description="Ищет по названию, компании, навыкам, описанию и локациям"
                // Ключ — запрос: при переходе назад по истории поле показывает запрос из адреса.
                key={query}
                defaultValue={query}
                flex={1}
              />
              {/* Поиск по словам идёт внутри выбранной компании. */}
              {companyParam === null ? null : (
                <input type="hidden" name="company" value={companyParam} />
              )}
              <Button type="submit">Найти</Button>
            </Group>
          </form>
        </search>
        <Results query={query} companyParam={companyParam} />
      </Stack>
    </Container>
  );
}
