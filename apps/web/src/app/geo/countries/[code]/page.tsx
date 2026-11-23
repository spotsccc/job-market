import { ancestors, isCountryCode } from '@job-market/geo';
import type { CountryCode } from '@job-market/geo';
import { log as rootLog } from '@job-market/logger';
import { Anchor, Text } from '@mantine/core';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { AliasesTable } from '../../aliases-table.tsx';
import { activeMembers } from '../../geo-data.ts';
import { getCountry } from '../../place-data.ts';
import type { CountryDetails } from '../../place-data.ts';
import {
  AncestorChain,
  CONTINENTS,
  Field,
  Fields,
  LoadError,
  PageHeader,
  RegionBadges,
  codesOf,
  Section,
  formatNumber,
} from '../../ui.tsx';
import { CitiesSection } from './cities-section.tsx';

const log = rootLog.with({ module: 'geo-admin', action: 'getCountry' });

type SearchValue = string | readonly string[] | undefined;

type CountryPageProps = Readonly<{
  params: Promise<Readonly<{ code: string }>>;
  searchParams: Promise<Readonly<Record<string, SearchValue>>>;
}>;

function readPage(value: SearchValue): number {
  const page = typeof value === 'string' ? Number(value) : 1;
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

function CountryFields({
  code,
  details,
}: Readonly<{ code: CountryCode; details: CountryDetails }>): ReactNode {
  const { country, regions, allRegions } = details;
  return (
    <Fields>
      <Field label="Ключ места">
        <Text ff="monospace">country:{country.code}</Text>
      </Field>
      <Field label="Название (ru)">{country.nameRu}</Field>
      <Field label="Название (en)">{country.nameEn}</Field>
      <Field label="ISO alpha-2 / alpha-3">
        <Text ff="monospace">{`${country.code} / ${country.iso3}`}</Text>
      </Field>
      <Field label="Континент">{CONTINENTS[country.continent] ?? country.continent}</Field>
      <Field label="Население">{formatNumber(country.population)}</Field>
      <Field label="GeoNames id">
        <Anchor href={`https://www.geonames.org/${String(country.geonameId)}`}>
          {country.geonameId}
        </Anchor>
      </Field>
      <Field label="Регионы найма">
        <RegionBadges codes={codesOf(regions)} regions={allRegions} />
      </Field>
      <Field label="Предки (П13)">
        <AncestorChain
          places={ancestors({ kind: 'country', code }, activeMembers(allRegions))}
          regions={allRegions}
        />
      </Field>
    </Fields>
  );
}

export default async function CountryPage({
  params,
  searchParams,
}: CountryPageProps): Promise<ReactNode> {
  const { code: rawCode } = await params;
  const search = await searchParams;
  const code = rawCode.toUpperCase();
  if (!isCountryCode(code)) notFound();
  const page = readPage(search['page']);
  const name = (typeof search['city'] === 'string' ? search['city'] : '').trim();

  const details = await getCountry(code, { page, name });
  if (details === null) notFound();
  if (details instanceof Error) {
    log.error('Geo country failed', { err: details, code });
    return <LoadError message="Не удалось загрузить страну" />;
  }

  return (
    <>
      <PageHeader title={details.country.nameRu}>
        <Anchor href="/geo#countries">Страны</Anchor>
        <Text>{code}</Text>
      </PageHeader>
      <CountryFields code={code} details={details} />
      <CitiesSection countryCode={code} cities={details} page={page} name={name} />
      <Section title={`Названия: ${String(details.aliases.length)}`}>
        <AliasesTable aliases={details.aliases} />
      </Section>
    </>
  );
}
