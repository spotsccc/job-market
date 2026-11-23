import {
  Anchor,
  Button,
  Group,
  Table,
  TableScrollContainer,
  TableTbody,
  TableTd,
  TableTh,
  TableThead,
  TableTr,
  Text,
  TextInput,
} from '@mantine/core';
import type { ReactNode } from 'react';

import { PageLinks } from '../../page-links.tsx';
import { CITIES_PAGE_SIZE } from '../../place-data.ts';
import type { CityItem, CityPage } from '../../place-data.ts';
import { ArchivedBadge, Section, formatNumber } from '../../ui.tsx';

type CitiesSectionProps = Readonly<{
  countryCode: string;
  cities: CityPage;
  page: number;
  /** Фильтр по названию из адреса. */
  name: string;
}>;

function CityRow({ city, position }: Readonly<{ city: CityItem; position: number }>): ReactNode {
  return (
    <TableTr>
      <TableTd>
        <Text size="sm" c="dimmed">
          {position}
        </Text>
      </TableTd>
      <TableTd>
        <Group gap="xs" wrap="nowrap">
          <Anchor href={`/geo/cities/${String(city.id)}`}>{city.name}</Anchor>
          <ArchivedBadge archived={city.archived} />
        </Group>
      </TableTd>
      <TableTd>{city.nameRu ?? '—'}</TableTd>
      <TableTd>{city.nameEn ?? '—'}</TableTd>
      <TableTd>{city.admin1Code ?? '—'}</TableTd>
      <TableTd>{formatNumber(city.population)}</TableTd>
      <TableTd>
        <Text size="sm">{city.timezone}</Text>
      </TableTd>
    </TableTr>
  );
}

function CitiesTable({
  cities,
  offset,
}: Readonly<{ cities: readonly CityItem[]; offset: number }>): ReactNode {
  return (
    <TableScrollContainer minWidth={900}>
      <Table striped highlightOnHover withTableBorder>
        <TableThead>
          <TableTr>
            <TableTh>#</TableTh>
            <TableTh>Город</TableTh>
            <TableTh>ru</TableTh>
            <TableTh>en</TableTh>
            <TableTh>admin1</TableTh>
            <TableTh>Население</TableTh>
            <TableTh>Часовой пояс</TableTh>
          </TableTr>
        </TableThead>
        <TableTbody>
          {cities.map((city, index) => (
            <CityRow key={city.id} city={city} position={offset + index + 1} />
          ))}
        </TableTbody>
      </Table>
    </TableScrollContainer>
  );
}

/** Города страны от больших к меньшим, с фильтром по названию и страницами. */
export function CitiesSection({ countryCode, cities, page, name }: CitiesSectionProps): ReactNode {
  const pages = Math.max(1, Math.ceil(cities.total / CITIES_PAGE_SIZE));
  return (
    <Section title={`Города: ${formatNumber(cities.total)}`}>
      <form action={`/geo/countries/${countryCode}`} method="get">
        <Group gap="sm" align="flex-end">
          <TextInput
            name="city"
            type="search"
            label="Фильтр по названию"
            placeholder="часть названия: GeoNames, ru или en"
            key={name}
            defaultValue={name}
            flex={1}
          />
          <Button type="submit">Показать</Button>
        </Group>
      </form>
      {cities.cities.length === 0 ? (
        <Text c="dimmed">Городов нет</Text>
      ) : (
        <CitiesTable cities={cities.cities} offset={(page - 1) * CITIES_PAGE_SIZE} />
      )}
      {pages > 1 ? (
        <PageLinks
          page={page}
          total={pages}
          query={name === '' ? '' : new URLSearchParams({ city: name }).toString()}
        />
      ) : null}
    </Section>
  );
}
