import { db } from '@job-market/db';
import { searchPlaces } from '@job-market/geo/server';
import { log as rootLog } from '@job-market/logger';
import {
  Anchor,
  Badge,
  Button,
  Group,
  Table,
  TableTbody,
  TableTd,
  TableTh,
  TableThead,
  TableTr,
  Text,
  TextInput,
} from '@mantine/core';
import type { ReactNode } from 'react';

import { LoadError, formatNumber, placeHref } from './ui.tsx';

const log = rootLog.with({ module: 'geo-admin', action: 'searchPlaces' });

/** Сколько подсказок показываем в поиске. */
const SEARCH_LIMIT = 50;

const KINDS = { city: 'город', country: 'страна', region: 'регион', anywhere: '' } as const;

async function SearchResults({ query }: Readonly<{ query: string }>): Promise<ReactNode> {
  const result = await searchPlaces(db, query, { locale: 'ru', limit: SEARCH_LIMIT });
  if (result instanceof Error) {
    log.error('Geo search failed', { err: result, query });
    return <LoadError message="Не удалось выполнить поиск" />;
  }
  if (result.length === 0) {
    return (
      <Text c="dimmed">
        Ничего не нашлось. Поиск идёт по началу названия, от двух символов, без архивных мест.
      </Text>
    );
  }
  return (
    <Table striped withTableBorder>
      <TableThead>
        <TableTr>
          <TableTh>Место</TableTh>
          <TableTh>Вид</TableTh>
          <TableTh>Население</TableTh>
        </TableTr>
      </TableThead>
      <TableTbody>
        {result.map((suggestion) => (
          <TableTr key={placeHref(suggestion.place)}>
            <TableTd>
              <Anchor href={placeHref(suggestion.place)}>{suggestion.label}</Anchor>
            </TableTd>
            <TableTd>
              <Badge variant="light">{KINDS[suggestion.place.kind]}</Badge>
            </TableTd>
            <TableTd>
              {suggestion.population === null ? '—' : formatNumber(suggestion.population)}
            </TableTd>
          </TableTr>
        ))}
      </TableTbody>
    </Table>
  );
}

/** Поиск места тем же автодополнением, что и в приложении (П14). */
export function PlaceSearch({ query }: Readonly<{ query: string }>): ReactNode {
  return (
    <>
      <search>
        <form action="/geo" method="get">
          <Group gap="sm" align="flex-end">
            <TextInput
              name="q"
              type="search"
              label="Название"
              placeholder="бер, Питер, UK, EU"
              description="По началу любого названия, как автодополнение (П14)"
              // Ключ — запрос: при переходе назад по истории поле показывает запрос из адреса.
              key={query}
              defaultValue={query}
              flex={1}
            />
            <Button type="submit">Найти</Button>
          </Group>
        </form>
      </search>
      {query === '' ? null : <SearchResults query={query} />}
    </>
  );
}
