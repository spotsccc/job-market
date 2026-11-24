import { log as rootLog } from '@job-market/logger';
import {
  Alert,
  Anchor,
  Badge,
  Breadcrumbs,
  Container,
  Divider,
  Group,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { Company } from '../company.tsx';
import { getVacancy } from '../get-vacancy.ts';
import type { VacancyDetails } from '../get-vacancy.ts';
import { Conditions } from '../vacancy-card.tsx';
import {
  ApplySection,
  PlacesSection,
  PointsSection,
  PublicationSection,
  ServiceSection,
  SiblingsSection,
  SkillsSection,
  TermsSection,
} from './sections.tsx';

const log = rootLog.with({ module: 'vacancies', action: 'getVacancy' });

type VacancyPageProps = Readonly<{ params: Promise<Readonly<{ id: string }>> }>;

export async function generateMetadata({ params }: VacancyPageProps): Promise<Metadata> {
  const vacancy = await getVacancy((await params).id);
  if (vacancy === null || vacancy instanceof Error) return { title: 'Вакансия — job-market' };
  const name = vacancy.companyName ?? vacancy.company;
  const company = name === null ? '' : ` · ${name}`;
  return { title: `${vacancy.title}${company} — job-market` };
}

function Header({ vacancy }: Readonly<{ vacancy: VacancyDetails }>): ReactNode {
  return (
    <Stack gap="xs">
      <Breadcrumbs>
        <Anchor href="/vacancies">Вакансии</Anchor>
        <Text>{vacancy.title}</Text>
      </Breadcrumbs>
      <Title order={1}>{vacancy.title}</Title>
      <Group gap="xs">
        <Company vacancy={vacancy} size="lg" />
        {vacancy.hiringParty === 'agency' ? (
          <Badge variant="outline" color="orange">
            агентство
          </Badge>
        ) : null}
      </Group>
      {vacancy.occupation === null ? null : <Text c="dimmed">{vacancy.occupation}</Text>}
    </Stack>
  );
}

/** Страница вакансии: все поля вакансии, её места, публикация и служебные данные. */
export default async function VacancyPage({ params }: VacancyPageProps): Promise<ReactNode> {
  const { id } = await params;
  const vacancy = await getVacancy(id);
  if (vacancy === null) notFound();
  if (vacancy instanceof Error) {
    log.error('Vacancy load failed', { err: vacancy, id });
    return (
      <Container component="main" size="md" py="xl">
        <Alert color="red" title="Ошибка" role="alert">
          Не удалось загрузить вакансию
        </Alert>
      </Container>
    );
  }

  return (
    <Container component="main" size="md" py="xl">
      <Stack gap="xl">
        <Stack gap="md">
          <Header vacancy={vacancy} />
          <Conditions vacancy={vacancy} />
          <Text size="lg">{vacancy.summary}</Text>
        </Stack>
        <TermsSection vacancy={vacancy} />
        <PlacesSection vacancy={vacancy} />
        <SkillsSection vacancy={vacancy} />
        <PointsSection title="Обязанности" points={vacancy.responsibilities} />
        <PointsSection title="Требования" points={vacancy.requirements} />
        <PointsSection title="Условия и бонусы" points={vacancy.benefits} />
        <ApplySection vacancy={vacancy} />
        <Divider />
        <PublicationSection vacancy={vacancy} />
        <SiblingsSection vacancy={vacancy} />
        <ServiceSection vacancy={vacancy} />
      </Stack>
    </Container>
  );
}
