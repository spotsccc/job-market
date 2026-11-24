import {
  Accordion,
  AccordionControl,
  AccordionItem,
  AccordionPanel,
  Anchor,
  Badge,
  Card,
  Group,
  List,
  ListItem,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import type { ReactNode } from 'react';

import { formatSalary } from './format-salary.ts';
import {
  EMPLOYMENT_TYPE_LABELS,
  LANGUAGE_LEVEL_LABELS,
  SENIORITY_LABELS,
  WORKPLACE_LABELS,
  formatYearsFrom,
} from './labels.ts';
import type { VacancyPlace, VacancySearchItem } from './search-vacancies.ts';

type VacancyProps = Readonly<{ vacancy: VacancySearchItem }>;

// Карточка рендерится на сервере: часовой пояс задаём явно, чтобы дата не зависела от машины.
const dateFormat = new Intl.DateTimeFormat('ru', { dateStyle: 'medium', timeZone: 'UTC' });

function hostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function placeList(places: readonly VacancyPlace[], role: VacancyPlace['role']): string {
  return places
    .filter((place) => place.role === role)
    .map((place) => place.label)
    .join('; ');
}

function Header({ vacancy }: VacancyProps): ReactNode {
  const { company, companyUrl } = vacancy;
  return (
    <Stack gap={4}>
      <Title order={3}>
        <Anchor href={`/vacancies/${vacancy.id}`} inherit>
          {vacancy.title}
        </Anchor>
      </Title>
      <Group gap="xs">
        {company === null ? null : companyUrl === null ? (
          <Text fw={500}>{company}</Text>
        ) : (
          <Anchor href={companyUrl} target="_blank" rel="noreferrer" fw={500}>
            {company}
          </Anchor>
        )}
        {vacancy.hiringParty === 'agency' ? (
          <Badge variant="outline" color="orange" size="sm">
            агентство
          </Badge>
        ) : null}
      </Group>
      {vacancy.occupation === null ? null : (
        <Text size="sm" c="dimmed">
          {vacancy.occupation}
          {vacancy.suggestedOccupation === null
            ? null
            : ` · предложено: ${vacancy.suggestedOccupation}`}
        </Text>
      )}
    </Stack>
  );
}

type PlaceLine = Readonly<{ label: string; text: string }>;

/** Места: офис и откуда можно работать по справочнику; без мест справочника — как в тексте. */
function Places({ vacancy }: VacancyProps): ReactNode {
  const office = placeList(vacancy.places, 'office');
  const hiring = placeList(vacancy.places, 'hiring');
  const lines: readonly PlaceLine[] = [
    ...(office === '' ? [] : [{ label: 'Офис', text: office }]),
    ...(hiring === '' ? [] : [{ label: 'Откуда', text: hiring }]),
    ...(vacancy.places.length === 0 && vacancy.locations.length > 0
      ? [{ label: 'Место', text: vacancy.locations.join('; ') }]
      : []),
  ];
  if (lines.length === 0) return null;
  return (
    <Stack gap={0}>
      {lines.map((line) => (
        <Text key={line.label} size="sm">
          <Text span c="dimmed" inherit>
            {line.label}:{' '}
          </Text>
          {line.text}
        </Text>
      ))}
    </Stack>
  );
}

export function Conditions({ vacancy }: VacancyProps): ReactNode {
  return (
    <Group gap="xs">
      {vacancy.seniority === null ? null : (
        <Badge variant="light">{SENIORITY_LABELS[vacancy.seniority]}</Badge>
      )}
      {vacancy.experienceYearsMin === null ? null : (
        <Badge variant="light">опыт {formatYearsFrom(vacancy.experienceYearsMin)}</Badge>
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
      {vacancy.languages.map((language) => (
        <Badge key={language.code} variant="light" color="indigo">
          {language.code.toUpperCase()}
          {language.level === null ? '' : ` ${LANGUAGE_LEVEL_LABELS[language.level]}`}
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
      {vacancy.equity === true ? (
        <Badge variant="light" color="yellow">
          доля / опционы
        </Badge>
      ) : null}
    </Group>
  );
}

export function Skills({
  label,
  skills,
  variant,
}: Readonly<{
  label: string;
  skills: readonly string[];
  variant: 'filled' | 'outline';
}>): ReactNode {
  if (skills.length === 0) return null;
  return (
    <Group gap="xs">
      <Text size="sm" c="dimmed">
        {label}:
      </Text>
      {skills.map((skill) => (
        <Badge key={skill} variant={variant} color="gray" tt="none">
          {skill}
        </Badge>
      ))}
    </Group>
  );
}

const SECTIONS = [
  { key: 'responsibilities', label: 'Обязанности' },
  { key: 'requirements', label: 'Требования' },
  { key: 'benefits', label: 'Условия' },
] as const;

/** Разделы описания свёрнуты: карточки в списке остаются короткими. */
function Sections({ vacancy }: VacancyProps): ReactNode {
  const sections = SECTIONS.filter((section) => vacancy[section.key].length > 0);
  if (sections.length === 0) return null;
  return (
    <Accordion multiple variant="contained" chevronPosition="left">
      {sections.map((section) => (
        <AccordionItem key={section.key} value={section.key}>
          <AccordionControl>
            {section.label} · {vacancy[section.key].length}
          </AccordionControl>
          <AccordionPanel>
            <List size="sm" spacing={4}>
              {vacancy[section.key].map((point, index) => (
                // Пункты могут повторяться: ключ — номер пункта.
                // oxlint-disable-next-line react/no-array-index-key
                <ListItem key={index}>{point}</ListItem>
              ))}
            </List>
          </AccordionPanel>
        </AccordionItem>
      ))}
    </Accordion>
  );
}

/** Способы отклика; `withLabel` — подпись «Отклик:», когда над ними нет заголовка. */
export function Apply({
  vacancy,
  withLabel = true,
}: VacancyProps & Readonly<{ withLabel?: boolean }>): ReactNode {
  const { urls, emails, directMessage } = vacancy.apply;
  if (urls.length === 0 && emails.length === 0 && !directMessage) return null;
  return (
    <Group gap="sm">
      {withLabel ? (
        <Text size="sm" fw={500}>
          Отклик:
        </Text>
      ) : null}
      {urls.map((url) => (
        <Anchor key={url} href={url} target="_blank" rel="noreferrer" size="sm">
          {hostname(url)}
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

export function Publication({ vacancy }: VacancyProps): ReactNode {
  return (
    <Text size="sm" c="dimmed">
      {vacancy.authorName === null ? null : (
        <>
          {vacancy.authorUrl === null ? (
            vacancy.authorName
          ) : (
            <Anchor href={vacancy.authorUrl} target="_blank" rel="noreferrer" inherit>
              {vacancy.authorName}
            </Anchor>
          )}
          {' · '}
        </>
      )}
      {/* «LinkedIn: ручной поиск» уже называет площадку, «forhr» — нет: «GeekJobs: forhr». */}
      {vacancy.sourceName.startsWith(vacancy.platformName)
        ? vacancy.sourceName
        : `${vacancy.platformName}: ${vacancy.sourceName}`}
      {' · '}
      {dateFormat.format(new Date(vacancy.postedAt))}
      {' · '}
      <Anchor href={vacancy.publicationUrl} target="_blank" rel="noreferrer" inherit>
        открыть публикацию
      </Anchor>
    </Text>
  );
}

export function VacancyCard({ vacancy }: VacancyProps): ReactNode {
  const salary = formatSalary(vacancy);
  return (
    <Card withBorder padding="lg" component="article">
      <Stack gap="sm">
        <Header vacancy={vacancy} />
        <Places vacancy={vacancy} />
        <Conditions vacancy={vacancy} />
        {salary === null ? null : <Text fw={500}>{salary}</Text>}
        <Text>{vacancy.summary}</Text>
        <Skills label="Обязательно" skills={vacancy.skills} variant="filled" />
        <Skills label="Плюсом" skills={vacancy.niceSkills} variant="outline" />
        <Sections vacancy={vacancy} />
        <Apply vacancy={vacancy} />
        <Publication vacancy={vacancy} />
      </Stack>
    </Card>
  );
}
