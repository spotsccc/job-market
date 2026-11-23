import { ancestors, covers } from '@job-market/geo';
import { log as rootLog } from '@job-market/logger';
import {
  Anchor,
  Table,
  TableTbody,
  TableTd,
  TableTh,
  TableThead,
  TableTr,
  Text,
} from '@mantine/core';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { AliasesTable } from '../../aliases-table.tsx';
import { getRegion } from '../../geo-data.ts';
import type { CountryItem, RegionDetails, RegionSummary } from '../../geo-data.ts';
import {
  AncestorChain,
  Field,
  Fields,
  LoadError,
  PageHeader,
  RegionBadges,
  Section,
  formatDate,
  formatNumber,
} from '../../ui.tsx';

const log = rootLog.with({ module: 'geo-admin', action: 'getRegion' });

type RegionPageProps = Readonly<{ params: Promise<Readonly<{ code: string }>> }>;

/** Действующие регионы и сам регион, даже архивный: по ним считаются предки и покрытие (П5, П13). */
function membersFor(code: string, regions: readonly RegionSummary[]): readonly RegionSummary[] {
  return regions.filter((item) => item.archivedAt === null || item.code === code);
}

/** Коды регионов, которые регион `code` покрывает (П5). */
function coveredBy(code: string, regions: readonly RegionSummary[]): readonly string[] {
  const members = membersFor(code, regions);
  return members
    .filter((other) => other.code !== code)
    .filter((other) =>
      covers({ kind: 'region', code }, { kind: 'region', code: other.code }, members),
    )
    .map((other) => other.code);
}

function RegionFields({ details }: Readonly<{ details: RegionDetails }>): ReactNode {
  const { region, countries, allRegions } = details;
  return (
    <Fields>
      <Field label="Ключ места">
        <Text ff="monospace">region:{region.code}</Text>
      </Field>
      <Field label="Название (ru)">{region.nameRu}</Field>
      <Field label="Название (en)">{region.nameEn}</Field>
      <Field label="Что считаем регионом">{region.description}</Field>
      <Field label="Стран">{countries.length}</Field>
      <Field label="Входит в (П13)">
        <AncestorChain
          places={ancestors(
            { kind: 'region', code: region.code },
            membersFor(region.code, allRegions),
          )}
          regions={allRegions}
        />
      </Field>
      <Field label="Покрывает регионы (П5)">
        <RegionBadges codes={coveredBy(region.code, allRegions)} regions={allRegions} />
      </Field>
      <Field label="В архиве с">{formatDate(region.archivedAt)}</Field>
    </Fields>
  );
}

function CountriesTable({ countries }: Readonly<{ countries: readonly CountryItem[] }>): ReactNode {
  return (
    <Table striped highlightOnHover withTableBorder>
      <TableThead>
        <TableTr>
          <TableTh>Код</TableTh>
          <TableTh>Страна</TableTh>
          <TableTh>Население</TableTh>
        </TableTr>
      </TableThead>
      <TableTbody>
        {countries.map((country) => (
          <TableTr key={country.code}>
            <TableTd>
              <Anchor href={`/geo/countries/${country.code}`} ff="monospace">
                {country.code}
              </Anchor>
            </TableTd>
            <TableTd>
              <Anchor href={`/geo/countries/${country.code}`}>{country.nameRu}</Anchor>
              <Text size="sm" c="dimmed">
                {country.nameEn}
              </Text>
            </TableTd>
            <TableTd>{formatNumber(country.population)}</TableTd>
          </TableTr>
        ))}
      </TableTbody>
    </Table>
  );
}

export default async function RegionPage({ params }: RegionPageProps): Promise<ReactNode> {
  const { code } = await params;
  // Код региона — строчные латинские буквы и `_` (как в geo_regions); другое — 404, а не ошибка.
  if (!/^[a-z][a-z_]*$/u.test(code)) notFound();
  const details = await getRegion(code);
  if (details === null) notFound();
  if (details instanceof Error) {
    log.error('Geo region failed', { err: details, code });
    return <LoadError message="Не удалось загрузить регион" />;
  }
  const { region, countries, aliases } = details;

  return (
    <>
      <PageHeader title={region.nameRu} archived={region.archivedAt !== null}>
        <Anchor href="/geo">Регионы найма</Anchor>
        <Text>{region.code}</Text>
      </PageHeader>
      <RegionFields details={details} />
      <Section title={`Страны: ${String(countries.length)}`}>
        <CountriesTable countries={countries} />
      </Section>
      <Section title={`Названия: ${String(aliases.length)}`}>
        <AliasesTable aliases={aliases} />
      </Section>
    </>
  );
}
