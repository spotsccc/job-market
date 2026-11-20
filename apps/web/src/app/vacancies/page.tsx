import { log as rootLog } from '@job-market/logger';
import { Alert, Button, Container, Group, Stack, Text, TextInput, Title } from '@mantine/core';
import type { ReactNode } from 'react';

import { searchVacancies } from './search-vacancies.ts';
import { VacancyCard } from './vacancy-card.tsx';

const log = rootLog.with({ module: 'vacancies', action: 'searchVacancies' });

type VacanciesPageProps = Readonly<{
  searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}>;

async function Results({ query }: Readonly<{ query: string }>): Promise<ReactNode> {
  const result = await searchVacancies(query);
  if (result instanceof Error) {
    log.error('Vacancy search failed', { err: result, query });
    return (
      <Alert color="red" title="Ошибка" role="alert">
        Не удалось загрузить вакансии
      </Alert>
    );
  }
  if (result.total === 0) {
    return (
      <Text c="dimmed">{query === '' ? 'В базе пока нет вакансий' : 'Ничего не нашлось'}</Text>
    );
  }
  return (
    <Stack gap="md">
      <Text c="dimmed">
        {query === '' ? 'Вакансий в базе' : 'Найдено'}: {result.total}
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
  const { q } = await searchParams;
  const query = (typeof q === 'string' ? q : '').trim();

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
              <Button type="submit">Найти</Button>
            </Group>
          </form>
        </search>
        <Results query={query} />
      </Stack>
    </Container>
  );
}
