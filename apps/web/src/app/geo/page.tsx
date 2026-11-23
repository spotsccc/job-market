import { log as rootLog } from '@job-market/logger';
import { Stack, Text, Title } from '@mantine/core';
import type { ReactNode } from 'react';

import { getOverview } from './geo-data.ts';
import type { CountrySummary, GeoOverview } from './geo-data.ts';
import { ContinentFilter, CountriesTable, RegionsTable, Totals } from './overview-tables.tsx';
import { PlaceSearch } from './place-search.tsx';
import { CONTINENTS, LoadError, Section } from './ui.tsx';

const log = rootLog.with({ module: 'geo-admin', action: 'getOverview' });

type GeoPageProps = Readonly<{
  searchParams: Promise<Readonly<Record<string, string | readonly string[] | undefined>>>;
}>;

function onContinent(
  countries: readonly CountrySummary[],
  continent: string | null,
): readonly CountrySummary[] {
  return continent === null
    ? countries
    : countries.filter((country) => country.continent === continent);
}

function Directory({
  overview,
  continent,
}: Readonly<{ overview: GeoOverview; continent: string | null }>): ReactNode {
  return (
    <>
      <Section title="Регионы найма">
        <Text size="sm" c="dimmed">
          От узких к широким. Регион покрывает другой, если в нём есть все страны другого (П5).
        </Text>
        <RegionsTable regions={overview.regions} />
      </Section>
      <Section title="Страны" id="countries">
        <ContinentFilter countries={overview.countries} continent={continent} />
        <CountriesTable
          countries={onContinent(overview.countries, continent)}
          regions={overview.regions}
        />
      </Section>
    </>
  );
}

export default async function GeoPage({ searchParams }: GeoPageProps): Promise<ReactNode> {
  const params = await searchParams;
  const query = (typeof params['q'] === 'string' ? params['q'] : '').trim();
  const continentParam = params['continent'];
  const continent =
    typeof continentParam === 'string' && continentParam in CONTINENTS ? continentParam : null;

  const overview = await getOverview();
  if (overview instanceof Error) log.error('Geo overview failed', { err: overview });

  return (
    <>
      <Stack gap="xs">
        <Title order={1}>Гео-справочник</Title>
        <Text c="dimmed">
          Регионы найма, страны, города и их названия. У каждого места — своя страница: состав,
          предки и названия, по которым его находит разбор.
        </Text>
      </Stack>
      {overview instanceof Error ? (
        <LoadError message="Не удалось загрузить справочник" />
      ) : (
        <Totals totals={overview.totals} />
      )}
      <Section title="Поиск места">
        <PlaceSearch query={query} />
      </Section>
      {overview instanceof Error ? null : <Directory overview={overview} continent={continent} />}
    </>
  );
}
