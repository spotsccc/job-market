import type { EmploymentType, Seniority, Workplace } from '@job-market/core';
import { Anchor, Badge, Card, Group, Stack, Text, Title } from '@mantine/core';
import type { ReactNode } from 'react';

import type { VacancySearchItem } from './search-vacancies.ts';

// Карточка рендерится на сервере: часовой пояс задаём явно, чтобы дата не зависела от машины.
const dateFormat = new Intl.DateTimeFormat('ru', { dateStyle: 'medium', timeZone: 'UTC' });

const SENIORITY_LABELS: Readonly<Record<Seniority, string>> = {
  intern: 'стажёр',
  junior: 'junior',
  middle: 'middle',
  senior: 'senior',
  lead: 'lead',
  principal: 'principal',
};

const WORKPLACE_LABELS: Readonly<Record<Workplace, string>> = {
  remote: 'удалённо',
  hybrid: 'гибрид',
  onsite: 'в офисе',
};

const EMPLOYMENT_TYPE_LABELS: Readonly<Record<EmploymentType, string>> = {
  full_time: 'полная занятость',
  part_time: 'частичная занятость',
  contract: 'контракт',
  freelance: 'фриланс',
  internship: 'стажировка',
};

function Conditions({ vacancy }: Readonly<{ vacancy: VacancySearchItem }>): ReactNode {
  return (
    <Group gap="xs">
      {vacancy.seniority === null ? null : (
        <Badge variant="light">{SENIORITY_LABELS[vacancy.seniority]}</Badge>
      )}
      {vacancy.workplace === null ? null : (
        <Badge variant="light" color="teal">
          {WORKPLACE_LABELS[vacancy.workplace]}
        </Badge>
      )}
      {vacancy.isRemoteFromAnywhere ? (
        <Badge variant="light" color="teal">
          из любой страны
        </Badge>
      ) : null}
      {vacancy.employmentTypes.map((type) => (
        <Badge key={type} variant="light" color="gray">
          {EMPLOYMENT_TYPE_LABELS[type]}
        </Badge>
      ))}
      {vacancy.relocation === true ? (
        <Badge variant="light" color="grape">
          релокация
        </Badge>
      ) : null}
      {vacancy.visaSponsorship === true ? (
        <Badge variant="light" color="grape">
          виза
        </Badge>
      ) : null}
    </Group>
  );
}

function Apply({ vacancy }: Readonly<{ vacancy: VacancySearchItem }>): ReactNode {
  const { urls, emails, directMessage } = vacancy.apply;
  if (urls.length === 0 && emails.length === 0 && !directMessage) return null;
  return (
    <Group gap="sm">
      <Text size="sm" fw={500}>
        Отклик:
      </Text>
      {urls.map((url) => (
        <Anchor key={url} href={url} target="_blank" rel="noreferrer" size="sm">
          {new URL(url).hostname}
        </Anchor>
      ))}
      {emails.map((email) => (
        <Anchor key={email} href={`mailto:${email}`} size="sm">
          {email}
        </Anchor>
      ))}
      {directMessage ? (
        <Text size="sm" c="dimmed">
          написать автору
        </Text>
      ) : null}
    </Group>
  );
}

export function VacancyCard({ vacancy }: Readonly<{ vacancy: VacancySearchItem }>): ReactNode {
  const place = [vacancy.company, vacancy.locations.join(', ')].filter(Boolean).join(' · ');
  return (
    <Card withBorder padding="lg" component="article">
      <Stack gap="sm">
        <Stack gap={0}>
          <Title order={3}>{vacancy.title}</Title>
          {place === '' ? null : <Text c="dimmed">{place}</Text>}
        </Stack>
        <Conditions vacancy={vacancy} />
        {vacancy.salaryRaw === null ? null : <Text fw={500}>{vacancy.salaryRaw}</Text>}
        <Text>{vacancy.summary}</Text>
        {vacancy.skills.length === 0 ? null : (
          <Group gap="xs">
            {vacancy.skills.map((skill) => (
              <Badge key={skill} variant="outline" color="gray" tt="none">
                {skill}
              </Badge>
            ))}
          </Group>
        )}
        <Apply vacancy={vacancy} />
        <Text size="sm" c="dimmed">
          <Anchor href={vacancy.authorUrl} target="_blank" rel="noreferrer" inherit>
            {vacancy.authorName}
          </Anchor>
          {' · '}
          {dateFormat.format(new Date(vacancy.postedAt))}
          {' · '}
          <Anchor href={vacancy.postUrl} target="_blank" rel="noreferrer" inherit>
            открыть пост
          </Anchor>
        </Text>
      </Stack>
    </Card>
  );
}
