import {
  Anchor,
  Badge,
  Group,
  Paper,
  SimpleGrid,
  Table,
  TableScrollContainer,
  TableTbody,
  TableTd,
  TableTh,
  TableThead,
  TableTr,
  Text,
} from '@mantine/core';
import type { ReactNode } from 'react';

import type { CountrySummary, GeoTotals, RegionSummary } from './geo-data.ts';
import { ArchivedBadge, CONTINENTS, RegionBadges, formatNumber } from './ui.tsx';

const TOTALS_COLUMNS = { base: 2, sm: 4 } as const;

function Stat({
  label,
  value,
  archived = 0,
}: Readonly<{ label: string; value: number; archived?: number }>): ReactNode {
  return (
    <Paper withBorder p="md" radius="md">
      <Text size="sm" c="dimmed">
        {label}
      </Text>
      <Text fz="xl" fw={700}>
        {formatNumber(value)}
      </Text>
      {archived > 0 ? (
        <Text size="xs" c="dimmed">
          из них в архиве: {formatNumber(archived)}
        </Text>
      ) : null}
    </Paper>
  );
}

export function Totals({ totals }: Readonly<{ totals: GeoTotals }>): ReactNode {
  return (
    <SimpleGrid cols={TOTALS_COLUMNS}>
      <Stat label="Регионы найма" value={totals.regions} archived={totals.archivedRegions} />
      <Stat label="Страны" value={totals.countries} />
      <Stat label="Города" value={totals.cities} archived={totals.archivedCities} />
      <Stat label="Названия" value={totals.aliases} />
    </SimpleGrid>
  );
}

export function RegionsTable({
  regions,
}: Readonly<{ regions: readonly RegionSummary[] }>): ReactNode {
  return (
    <TableScrollContainer minWidth={800}>
      <Table striped withTableBorder>
        <TableThead>
          <TableTr>
            <TableTh>Код</TableTh>
            <TableTh>Название</TableTh>
            <TableTh>Стран</TableTh>
            <TableTh>Что считаем регионом</TableTh>
          </TableTr>
        </TableThead>
        <TableTbody>
          {regions.map((region) => (
            <TableTr key={region.code}>
              <TableTd>
                <Group gap="xs" wrap="nowrap">
                  <Anchor href={`/geo/regions/${region.code}`} ff="monospace">
                    {region.code}
                  </Anchor>
                  <ArchivedBadge archived={region.archivedAt !== null} />
                </Group>
              </TableTd>
              <TableTd>
                <Text>{region.nameRu}</Text>
                <Text size="sm" c="dimmed">
                  {region.nameEn}
                </Text>
              </TableTd>
              <TableTd>{region.countries.length}</TableTd>
              <TableTd>
                <Text size="sm">{region.description}</Text>
              </TableTd>
            </TableTr>
          ))}
        </TableTbody>
      </Table>
    </TableScrollContainer>
  );
}

export function ContinentFilter({
  countries,
  continent,
}: Readonly<{ countries: readonly CountrySummary[]; continent: string | null }>): ReactNode {
  return (
    <Group gap="xs">
      <Badge component="a" href="/geo#countries" variant={continent === null ? 'filled' : 'light'}>
        Все: {countries.length}
      </Badge>
      {Object.keys(CONTINENTS).map((code) => (
        <Badge
          key={code}
          component="a"
          href={`/geo?continent=${code}#countries`}
          variant={continent === code ? 'filled' : 'light'}
        >
          {CONTINENTS[code]}: {countries.filter((country) => country.continent === code).length}
        </Badge>
      ))}
    </Group>
  );
}

function CountryRow({
  country,
  regions,
}: Readonly<{ country: CountrySummary; regions: readonly RegionSummary[] }>): ReactNode {
  const href = `/geo/countries/${country.code}`;
  return (
    <TableTr>
      <TableTd>
        <Anchor href={href} ff="monospace">
          {country.code}
        </Anchor>
        <Text size="xs" c="dimmed" ff="monospace">
          {country.iso3}
        </Text>
      </TableTd>
      <TableTd>
        <Anchor href={href}>{country.nameRu}</Anchor>
        <Text size="sm" c="dimmed">
          {country.nameEn}
        </Text>
      </TableTd>
      <TableTd>{CONTINENTS[country.continent] ?? country.continent}</TableTd>
      <TableTd>{formatNumber(country.population)}</TableTd>
      <TableTd>{formatNumber(country.cities)}</TableTd>
      <TableTd>
        <RegionBadges codes={country.regions} regions={regions} />
      </TableTd>
    </TableTr>
  );
}

export function CountriesTable({
  countries,
  regions,
}: Readonly<{
  countries: readonly CountrySummary[];
  regions: readonly RegionSummary[];
}>): ReactNode {
  return (
    <TableScrollContainer minWidth={900}>
      <Table striped highlightOnHover withTableBorder>
        <TableThead>
          <TableTr>
            <TableTh>Код</TableTh>
            <TableTh>Страна</TableTh>
            <TableTh>Континент</TableTh>
            <TableTh>Население</TableTh>
            <TableTh>Городов</TableTh>
            <TableTh>Регионы найма</TableTh>
          </TableTr>
        </TableThead>
        <TableTbody>
          {countries.map((country) => (
            <CountryRow key={country.code} country={country} regions={regions} />
          ))}
        </TableTbody>
      </Table>
    </TableScrollContainer>
  );
}
