import { formatPlace } from '@job-market/geo';
import type { Place } from '@job-market/geo';
import {
  Alert,
  Anchor,
  Badge,
  Breadcrumbs,
  Group,
  Stack,
  Table,
  TableTbody,
  TableTd,
  TableTh,
  TableTr,
  Text,
  Title,
} from '@mantine/core';
import type { ReactNode } from 'react';

import type { RegionSummary } from './geo-data.ts';

const NUMBER = new Intl.NumberFormat('ru');

export function formatNumber(value: number): string {
  return NUMBER.format(value);
}

/** Дата строкой ISO → для показа. */
export function formatDate(iso: string | null): string | null {
  return iso === null ? null : new Date(iso).toLocaleString('ru');
}

export const CONTINENTS: Readonly<Record<string, string>> = {
  EU: 'Европа',
  AS: 'Азия',
  AF: 'Африка',
  NA: 'Северная Америка',
  SA: 'Южная Америка',
  OC: 'Океания',
  AN: 'Антарктида',
};

/** Адрес страницы места в админке. */
export function placeHref(place: Place): string {
  if (place.kind === 'city') return `/geo/cities/${String(place.id)}`;
  if (place.kind === 'country') return `/geo/countries/${place.code}`;
  if (place.kind === 'region') return `/geo/regions/${place.code}`;
  return '/geo';
}

/** Название места; регион — по строке из базы, чтобы показать и архивный. */
function placeLabel(place: Place, regions: readonly RegionSummary[]): string {
  if (place.kind === 'region') {
    return regions.find((region) => region.code === place.code)?.nameRu ?? place.code;
  }
  return formatPlace(place, 'ru');
}

export function ArchivedBadge({ archived }: Readonly<{ archived: boolean }>): ReactNode {
  if (!archived) return null;
  return (
    <Badge color="gray" variant="light">
      архив
    </Badge>
  );
}

export function LoadError({ message }: Readonly<{ message: string }>): ReactNode {
  return (
    <Alert color="red" title="Ошибка" role="alert">
      {message}
    </Alert>
  );
}

/**
 * Заголовок страницы. `children` — хлебные крошки после корня «Гео»: ссылки `Anchor`
 * и последний пункт `Text`.
 */
export function PageHeader({
  title,
  archived = false,
  children,
}: Readonly<{ title: string; archived?: boolean; children: ReactNode }>): ReactNode {
  return (
    <Stack gap="xs">
      <Breadcrumbs>
        <Anchor href="/geo">Гео</Anchor>
        {children}
      </Breadcrumbs>
      <Group gap="sm" align="center">
        <Title order={1}>{title}</Title>
        <ArchivedBadge archived={archived} />
      </Group>
    </Stack>
  );
}

export function Section({
  title,
  id,
  children,
}: Readonly<{ title: string; id?: string; children: ReactNode }>): ReactNode {
  return (
    <Stack gap="sm" component="section" id={id}>
      <Title order={2} size="h3">
        {title}
      </Title>
      {children}
    </Stack>
  );
}

/** Карточка места: строки `Field`. */
export function Fields({ children }: Readonly<{ children: ReactNode }>): ReactNode {
  return (
    <Table variant="vertical" layout="fixed" withTableBorder>
      <TableTbody>{children}</TableTbody>
    </Table>
  );
}

export function Field({
  label,
  children,
}: Readonly<{ label: string; children: ReactNode }>): ReactNode {
  return (
    <TableTr>
      <TableTh w="30%">{label}</TableTh>
      <TableTd>{children ?? <Text c="dimmed">—</Text>}</TableTd>
    </TableTr>
  );
}

export function codesOf(regions: readonly RegionSummary[]): readonly string[] {
  return regions.map((region) => region.code);
}

/** Регионы бейджами-ссылками; архивный — серым. */
export function RegionBadges({
  codes,
  regions,
}: Readonly<{ codes: readonly string[]; regions: readonly RegionSummary[] }>): ReactNode {
  if (codes.length === 0) return <Text c="dimmed">—</Text>;
  return (
    <Group gap="xs">
      {codes.map((code) => {
        const region = regions.find((item) => item.code === code);
        return (
          <Badge
            key={code}
            component="a"
            href={`/geo/regions/${code}`}
            variant="light"
            color={region?.archivedAt === null ? 'blue' : 'gray'}
            title={region?.nameRu}
          >
            {code}
          </Badge>
        );
      })}
    </Group>
  );
}

/** Предки места (П13) ссылками, от ближнего к дальнему. */
export function AncestorChain({
  places,
  regions,
}: Readonly<{ places: readonly Place[]; regions: readonly RegionSummary[] }>): ReactNode {
  return (
    <Breadcrumbs separator="→">
      {places.map((place) => (
        <Anchor key={placeHref(place)} href={placeHref(place)}>
          {placeLabel(place, regions)}
        </Anchor>
      ))}
    </Breadcrumbs>
  );
}
