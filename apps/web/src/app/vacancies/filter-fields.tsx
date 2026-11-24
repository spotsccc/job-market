'use client';

import {
  Checkbox,
  Group,
  MultiSelect,
  NumberInput,
  SegmentedControl,
  Select,
  TreeSelect,
} from '@mantine/core';
import type { ComboboxItem, ComboboxItemGroup, TreeNodeData } from '@mantine/core';
import type { ReactNode } from 'react';

import type { VacancyFilters } from './filters.ts';
import {
  APPLY_OPTIONS,
  EMPLOYMENT_OPTIONS,
  HIRING_OPTIONS,
  PERIOD_OPTIONS,
  PLACE_MODE_OPTIONS,
  POSTED_OPTIONS,
  SENIORITY_OPTIONS,
  TAX_OPTIONS,
  WORKPLACE_OPTIONS,
} from './labels.ts';

/** Начальные значения полей: Mantine ждёт изменяемые массивы. */
export type FieldDefaults = {
  occupations: string[];
  seniorities: string[];
  skills: string[];
  languages: string[];
  workplaces: string[];
  employmentTypes: string[];
  hiringParties: string[];
  applyMethods: string[];
  platforms: string[];
  place: string | null;
  posted: string | null;
};

/** Варианты полей из базы в форме, которую ждёт Mantine. */
export type FieldData = {
  occupations: TreeNodeData[];
  places: ComboboxItemGroup<ComboboxItem>[];
  skills: ComboboxItem[];
  languages: ComboboxItem[];
  currencies: ComboboxItem[];
  companies: ComboboxItem[];
  platforms: ComboboxItem[];
};

export type FieldsProps = Readonly<{
  filters: VacancyFilters;
  defaults: Readonly<FieldDefaults>;
  data: Readonly<FieldData>;
}>;

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Mantine ждёт изменяемые массивы в data и defaultValue
export function RoleFields({ filters, defaults, data }: FieldsProps): ReactNode {
  return (
    <>
      <TreeSelect
        name="occupation"
        label="Профессия"
        placeholder="Любая"
        description="Узел вместе со всеми профессиями внутри"
        mode="checkbox"
        checkedStrategy="parent"
        data={data.occupations}
        defaultValue={defaults.occupations}
        searchable
        clearable
      />
      <MultiSelect
        name="seniority"
        label="Уровень"
        placeholder="Любой"
        data={SENIORITY_OPTIONS}
        defaultValue={defaults.seniorities}
        clearable
      />
      <NumberInput
        name="experience"
        label="Мой опыт, лет"
        description="Где требуют не больше и где опыт не указан"
        min={0}
        max={30}
        allowDecimal={false}
        defaultValue={filters.experienceYears ?? ''}
      />
    </>
  );
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Mantine ждёт изменяемые массивы в data и defaultValue
export function SkillFields({ defaults, data }: FieldsProps): ReactNode {
  return (
    <>
      <MultiSelect
        name="skill"
        label="Навыки"
        placeholder="Любые"
        description="Все выбранные — среди обязательных или «плюсом»"
        data={data.skills}
        defaultValue={defaults.skills}
        searchable
        clearable
        limit={100}
      />
      <MultiSelect
        name="language"
        label="Языки"
        placeholder="Любые"
        description="Вакансия упоминает хотя бы один"
        data={data.languages}
        defaultValue={defaults.languages}
        searchable
        clearable
      />
    </>
  );
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Mantine ждёт изменяемые массивы в data и defaultValue
export function LocationFields({ filters, defaults, data }: FieldsProps): ReactNode {
  return (
    <>
      <Select
        name="place"
        label="Место"
        placeholder="Любое"
        data={data.places}
        defaultValue={defaults.place}
        searchable
        clearable
        limit={50}
      />
      <SegmentedControl
        name="placeMode"
        fullWidth
        size="xs"
        data={PLACE_MODE_OPTIONS}
        defaultValue={filters.placeMode}
      />
      <MultiSelect
        name="workplace"
        label="Формат"
        placeholder="Любой"
        data={WORKPLACE_OPTIONS}
        defaultValue={defaults.workplaces}
        clearable
      />
      <Checkbox
        name="anywhere"
        value="1"
        label="Только откуда угодно"
        defaultChecked={filters.remoteFromAnywhere}
      />
      <Checkbox name="relocation" value="1" label="Релокация" defaultChecked={filters.relocation} />
      <Checkbox
        name="visa"
        value="1"
        label="Помогают с визой"
        defaultChecked={filters.visaSponsorship}
      />
    </>
  );
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Mantine ждёт изменяемые массивы в data и defaultValue
export function SalaryFields({ filters, data }: FieldsProps): ReactNode {
  return (
    <>
      <Checkbox
        name="withSalary"
        value="1"
        label="Только с зарплатой"
        defaultChecked={filters.withSalary}
      />
      <Group gap="xs" grow align="flex-start">
        <NumberInput
          name="salaryFrom"
          label="Зарплата от"
          description="Верх вилки, в выбранной валюте"
          min={0}
          allowDecimal={false}
          allowNegative={false}
          defaultValue={filters.salaryFrom ?? ''}
        />
        <Select
          name="salaryCurrency"
          label="Валюта"
          placeholder="Любая"
          data={data.currencies}
          defaultValue={filters.salaryCurrency}
          clearable
        />
      </Group>
      <Group gap="xs" grow>
        <Select
          name="salaryPeriod"
          label="Период"
          placeholder="Любой"
          data={PERIOD_OPTIONS}
          defaultValue={filters.salaryPeriod}
          clearable
        />
        <Select
          name="salaryTax"
          label="Налоги"
          placeholder="Любые"
          data={TAX_OPTIONS}
          defaultValue={filters.salaryTax}
          clearable
        />
      </Group>
      <Checkbox name="equity" value="1" label="Доля или опционы" defaultChecked={filters.equity} />
    </>
  );
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Mantine ждёт изменяемые массивы в data и defaultValue
export function TermsFields({ filters, defaults, data }: FieldsProps): ReactNode {
  return (
    <>
      <MultiSelect
        name="employment"
        label="Занятость"
        placeholder="Любая"
        data={EMPLOYMENT_OPTIONS}
        defaultValue={defaults.employmentTypes}
        clearable
      />
      <Select
        name="company"
        label="Компания"
        placeholder="Любая"
        description="Из справочника компаний"
        data={data.companies}
        defaultValue={filters.companyId}
        searchable
        clearable
        limit={50}
      />
      <MultiSelect
        name="hiring"
        label="Кто нанимает"
        placeholder="Любой"
        data={HIRING_OPTIONS}
        defaultValue={defaults.hiringParties}
        clearable
      />
      <MultiSelect
        name="apply"
        label="Способ отклика"
        placeholder="Любой"
        data={APPLY_OPTIONS}
        defaultValue={defaults.applyMethods}
        clearable
      />
    </>
  );
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Mantine ждёт изменяемые массивы в data и defaultValue
export function PublicationFields({ defaults, data }: FieldsProps): ReactNode {
  return (
    <>
      <MultiSelect
        name="platform"
        label="Площадка"
        placeholder="Любая"
        data={data.platforms}
        defaultValue={defaults.platforms}
        clearable
      />
      <Select
        name="posted"
        label="Опубликована"
        placeholder="Когда угодно"
        data={POSTED_OPTIONS}
        defaultValue={defaults.posted}
        clearable
      />
    </>
  );
}
