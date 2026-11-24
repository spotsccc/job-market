'use client';

import { placeKey } from '@job-market/geo';
import { Button, Card, Divider, Grid, GridCol, Group, Stack, Text, TextInput } from '@mantine/core';
import type { TreeNodeData } from '@mantine/core';
import { useRouter } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import type { ReactNode, SubmitEvent } from 'react';

import {
  LocationFields,
  PublicationFields,
  RoleFields,
  SalaryFields,
  SkillFields,
  TermsFields,
} from './filter-fields.tsx';
import type { FieldData, FieldDefaults, FieldsProps } from './filter-fields.tsx';
import type { FilterOptions } from './filter-options.ts';
import { countActiveFilters } from './filters.ts';
import type { VacancyFilters } from './filters.ts';
import type { OccupationNode } from './occupation-tree.ts';

type FormProps = Readonly<{ filters: VacancyFilters; options: FilterOptions }>;

const PANEL_SPAN = { base: 12, md: 4, lg: 3 };
const RESULTS_SPAN = { base: 12, md: 8, lg: 9 };

function treeData(nodes: readonly OccupationNode[]): TreeNodeData[] {
  return nodes.map((node) =>
    node.children === undefined
      ? { value: node.value, label: node.label }
      : { value: node.value, label: node.label, children: treeData(node.children) },
  );
}

function fieldDefaults(filters: VacancyFilters): FieldDefaults {
  return {
    occupations: [...filters.occupations],
    seniorities: [...filters.seniorities],
    skills: [...filters.skills],
    languages: [...filters.languages],
    workplaces: [...filters.workplaces],
    employmentTypes: [...filters.employmentTypes],
    hiringParties: [...filters.hiringParties],
    applyMethods: [...filters.applyMethods],
    platforms: [...filters.platforms],
    place: filters.place === null ? null : placeKey(filters.place),
    posted: filters.postedWithinDays === null ? null : String(filters.postedWithinDays),
  };
}

function fieldData(options: FilterOptions): FieldData {
  return {
    occupations: treeData(options.occupations),
    places: options.places.map((group) => ({ group: group.group, items: [...group.items] })),
    skills: [...options.skills],
    languages: [...options.languages],
    currencies: [...options.currencies],
    platforms: [...options.platforms],
  };
}

/** Значение для адреса страницы: пустое и значение по умолчанию в адрес не идут. */
function isMeaningful(name: string, value: string, data: Readonly<FormData>): boolean {
  if (value === '') return false;
  // Способ сравнения места без места ничего не значит, `work` — по умолчанию.
  if (name === 'placeMode') return value !== 'work' && data.get('place') !== '';
  return true;
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Mantine ждёт изменяемые массивы в data и defaultValue
function FilterPanel({ active, ...props }: FieldsProps & Readonly<{ active: number }>): ReactNode {
  return (
    <Card withBorder padding="md" component="aside">
      <Stack gap="sm">
        <Group justify="space-between">
          <Text fw={600}>Фильтры{active === 0 ? '' : ` · ${String(active)}`}</Text>
          <Button component="a" href="/vacancies" variant="subtle" size="compact-sm">
            Сбросить
          </Button>
        </Group>
        <RoleFields {...props} />
        <SkillFields {...props} />
        <Divider label="Где" labelPosition="left" />
        <LocationFields {...props} />
        <Divider label="Деньги" labelPosition="left" />
        <SalaryFields {...props} />
        <Divider label="Условия и публикация" labelPosition="left" />
        <TermsFields {...props} />
        <PublicationFields {...props} />
        <Button type="submit">Применить</Button>
      </Stack>
    </Card>
  );
}

function SearchBar({ query }: Readonly<{ query: string }>): ReactNode {
  return (
    <search>
      <Group gap="sm" align="flex-end">
        <TextInput
          name="q"
          type="search"
          label="Поиск"
          placeholder='react удалённо, "senior backend", go -java'
          description="По названию, компании, навыкам, описанию, обязанностям, требованиям и местам"
          defaultValue={query}
          flex={1}
        />
        <Button type="submit">Найти</Button>
      </Group>
    </search>
  );
}

/**
 * Поиск и фильтры вакансий. Фильтры живут в адресе страницы: ссылку можно сохранить и
 * переслать. Форма отправляет только заданные поля, чтобы адрес оставался читаемым.
 * `children` — выдача под строкой поиска.
 */
export function VacancyFiltersForm({
  filters,
  options,
  children,
}: FormProps & Readonly<{ children: ReactNode }>): ReactNode {
  const router = useRouter();
  const defaults = useMemo(() => fieldDefaults(filters), [filters]);
  const data = useMemo(() => fieldData(options), [options]);

  const submit = useCallback(
    (event: SubmitEvent<HTMLFormElement>): void => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const params = new URLSearchParams();
      for (const [name, value] of form) {
        if (typeof value === 'string' && isMeaningful(name, value.trim(), form)) {
          params.append(name, value.trim());
        }
      }
      const query = params.toString();
      router.push(query === '' ? '/vacancies' : `/vacancies?${query}`);
    },
    [router],
  );

  return (
    <form action="/vacancies" method="get" onSubmit={submit}>
      <Grid gap="xl">
        <GridCol span={PANEL_SPAN}>
          <FilterPanel
            active={countActiveFilters(filters)}
            filters={filters}
            defaults={defaults}
            data={data}
          />
        </GridCol>
        <GridCol span={RESULTS_SPAN}>
          <Stack gap="lg">
            <SearchBar query={filters.q} />
            {children}
          </Stack>
        </GridCol>
      </Grid>
    </form>
  );
}
