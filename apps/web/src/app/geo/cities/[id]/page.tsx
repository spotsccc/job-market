import { ancestors, formatPlace, isCountryCode } from '@job-market/geo';
import type { CountryCode, Place } from '@job-market/geo';
import { log as rootLog } from '@job-market/logger';
import { Anchor, Text } from '@mantine/core';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { AliasesTable } from '../../aliases-table.tsx';
import { activeMembers } from '../../geo-data.ts';
import { getCity } from '../../place-data.ts';
import type { CityDetails } from '../../place-data.ts';
import {
  AncestorChain,
  Field,
  Fields,
  LoadError,
  PageHeader,
  Section,
  formatDate,
  formatNumber,
} from '../../ui.tsx';

const log = rootLog.with({ module: 'geo-admin', action: 'getCity' });

type CityPageProps = Readonly<{ params: Promise<Readonly<{ id: string }>> }>;

function CityFields({
  countryCode,
  details,
}: Readonly<{ countryCode: CountryCode; details: CityDetails }>): ReactNode {
  const { city, country, regions } = details;
  const lat = String(city.lat);
  const lng = String(city.lng);
  return (
    <Fields>
      <Field label="Ключ места">
        <Text ff="monospace">city:{city.id}</Text>
      </Field>
      <Field label="Название (GeoNames)">{city.name}</Field>
      <Field label="Название (ru)">{city.nameRu}</Field>
      <Field label="Название (en)">{city.nameEn}</Field>
      <Field label="Страна">
        <Anchor href={`/geo/countries/${country.code}`}>{country.nameRu}</Anchor>
      </Field>
      <Field label="admin1 (регион страны)">{city.admin1Code}</Field>
      <Field label="Население">{formatNumber(city.population)}</Field>
      <Field label="Часовой пояс">{city.timezone}</Field>
      <Field label="Координаты">
        <Anchor
          href={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=11/${lat}/${lng}`}
        >
          {`${lat}, ${lng}`}
        </Anchor>
      </Field>
      <Field label="GeoNames id">
        <Anchor href={`https://www.geonames.org/${String(city.id)}`}>{city.id}</Anchor>
      </Field>
      <Field label="Предки (П13)">
        <AncestorChain
          places={ancestors({ kind: 'city', id: city.id, countryCode }, activeMembers(regions))}
          regions={regions}
        />
      </Field>
      <Field label="В архиве с">{formatDate(city.archivedAt)}</Field>
    </Fields>
  );
}

export default async function CityPage({ params }: CityPageProps): Promise<ReactNode> {
  const { id: rawId } = await params;
  const id = /^[1-9]\d*$/u.test(rawId) ? Number(rawId) : Number.NaN;
  if (!Number.isSafeInteger(id)) notFound();

  const details = await getCity(id);
  if (details === null) notFound();
  if (details instanceof Error) {
    log.error('Geo city failed', { err: details, id });
    return <LoadError message="Не удалось загрузить город" />;
  }
  const { city, country, aliases } = details;
  if (!isCountryCode(city.countryCode)) notFound();
  const place: Place = { kind: 'city', id: city.id, countryCode: city.countryCode };

  return (
    <>
      <PageHeader title={formatPlace(place, 'ru', city)} archived={city.archivedAt !== null}>
        <Anchor href="/geo#countries">Страны</Anchor>
        <Anchor href={`/geo/countries/${country.code}`}>{country.nameRu}</Anchor>
        <Text>{city.name}</Text>
      </PageHeader>
      <CityFields countryCode={city.countryCode} details={details} />
      <Section title={`Названия: ${String(aliases.length)}`}>
        <AliasesTable aliases={aliases} />
      </Section>
    </>
  );
}
