import {
  Anchor,
  Badge,
  List,
  ListItem,
  Spoiler,
  Stack,
  Table,
  TableTbody,
  TableTd,
  TableTh,
  TableThead,
  TableTr,
  Text,
  Title,
} from '@mantine/core';
import type { ReactNode } from 'react';

import { formatSalary } from '../format-salary.ts';
import type { VacancyDetails } from '../get-vacancy.ts';
import {
  EMPLOYMENT_TYPE_LABELS,
  HIRING_PARTY_LABELS,
  LANGUAGE_LEVEL_LABELS,
  LOCATION_ROLE_LABELS,
  RESOLUTION_LABELS,
  SENIORITY_LABELS,
  WORKPLACE_LABELS,
  formatYearsFrom,
  yesNo,
} from '../labels.ts';
import { Apply, Publication, Skills } from '../vacancy-card.tsx';

type DetailsProps = Readonly<{ vacancy: VacancyDetails }>;

// Страница рендерится на сервере: часовой пояс задаём явно, чтобы время не зависело от машины.
const dateTimeFormat = new Intl.DateTimeFormat('ru', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
});

const RESOLUTION_COLORS = {
  resolved: 'teal',
  partial: 'yellow',
  not_found: 'red',
  ambiguous: 'orange',
} as const;

export function Section({
  title,
  children,
}: Readonly<{ title: string; children: ReactNode }>): ReactNode {
  return (
    <Stack gap="sm" component="section">
      <Title order={2} size="h3">
        {title}
      </Title>
      {children}
    </Stack>
  );
}

function Fields({ children }: Readonly<{ children: ReactNode }>): ReactNode {
  return (
    <Table variant="vertical" layout="fixed" withTableBorder>
      <TableTbody>{children}</TableTbody>
    </Table>
  );
}

/** Строка поля; пустое значение — прочерк. */
function Field({ label, children }: Readonly<{ label: string; children: ReactNode }>): ReactNode {
  return (
    <TableTr>
      <TableTh w="35%">{label}</TableTh>
      <TableTd>{children ?? <Text c="dimmed">—</Text>}</TableTd>
    </TableTr>
  );
}

function joinOrNull(values: readonly string[]): string | null {
  return values.length === 0 ? null : values.join(', ');
}

export function TermsSection({ vacancy }: DetailsProps): ReactNode {
  const languages = vacancy.languages.map(
    (language) =>
      `${language.code.toUpperCase()}${language.level === null ? '' : ` ${LANGUAGE_LEVEL_LABELS[language.level]}`}`,
  );
  return (
    <Section title="Детали">
      <Fields>
        <Field label="Профессия">
          {vacancy.occupation}
          {vacancy.suggestedOccupation === null ? null : (
            <Text size="sm" c="dimmed">
              Предложено моделью: {vacancy.suggestedOccupation}
            </Text>
          )}
        </Field>
        <Field label="Уровень">
          {vacancy.seniority === null ? null : SENIORITY_LABELS[vacancy.seniority]}
        </Field>
        <Field label="Опыт">
          {vacancy.experienceYearsMin === null ? null : formatYearsFrom(vacancy.experienceYearsMin)}
        </Field>
        <Field label="Формат">
          {vacancy.workplace === null ? null : WORKPLACE_LABELS[vacancy.workplace]}
        </Field>
        <Field label="Из любой страны">{vacancy.isRemoteFromAnywhere ? 'да' : 'нет'}</Field>
        <Field label="Занятость">
          {joinOrNull(vacancy.employmentTypes.map((type) => EMPLOYMENT_TYPE_LABELS[type]))}
        </Field>
        <Field label="Зарплата">{formatSalary(vacancy)}</Field>
        <Field label="Зарплата в тексте">{vacancy.salaryRaw}</Field>
        <Field label="Доля или опционы">{yesNo(vacancy.equity)}</Field>
        <Field label="Релокация">{yesNo(vacancy.relocation)}</Field>
        <Field label="Помощь с визой">{yesNo(vacancy.visaSponsorship)}</Field>
        <Field label="Языки">{joinOrNull(languages)}</Field>
        <Field label="Кто нанимает">{HIRING_PARTY_LABELS[vacancy.hiringParty]}</Field>
      </Fields>
    </Section>
  );
}

/** Места по справочнику с итогом распознавания; без мест справочника — как в тексте. */
export function PlacesSection({ vacancy }: DetailsProps): ReactNode {
  if (vacancy.places.length === 0) {
    return (
      <Section title="Места">
        <Text c="dimmed">
          {vacancy.locations.length === 0 ? 'Не указаны' : vacancy.locations.join('; ')}
        </Text>
      </Section>
    );
  }
  return (
    <Section title="Места">
      <Table withTableBorder>
        <TableThead>
          <TableTr>
            <TableTh>Роль</TableTh>
            <TableTh>Место</TableTh>
            <TableTh>Справочник</TableTh>
            <TableTh>В тексте</TableTh>
          </TableTr>
        </TableThead>
        <TableTbody>
          {vacancy.places.map((place, index) => (
            // Места вакансии упорядочены и не меняются местами: ключ — номер места.
            // oxlint-disable-next-line react/no-array-index-key
            <TableTr key={index}>
              <TableTd>{LOCATION_ROLE_LABELS[place.role]}</TableTd>
              <TableTd>{place.label}</TableTd>
              <TableTd>
                <Badge variant="light" color={RESOLUTION_COLORS[place.resolution]}>
                  {RESOLUTION_LABELS[place.resolution]}
                </Badge>
              </TableTd>
              <TableTd>{place.raw}</TableTd>
            </TableTr>
          ))}
        </TableTbody>
      </Table>
    </Section>
  );
}

export function SkillsSection({ vacancy }: DetailsProps): ReactNode {
  if (vacancy.skills.length === 0 && vacancy.niceSkills.length === 0) return null;
  return (
    <Section title="Навыки">
      <Skills label="Обязательно" skills={vacancy.skills} variant="filled" />
      <Skills label="Плюсом" skills={vacancy.niceSkills} variant="outline" />
    </Section>
  );
}

/** Раздел описания пунктами; пустой не показывается. */
export function PointsSection({
  title,
  points,
}: Readonly<{ title: string; points: readonly string[] }>): ReactNode {
  if (points.length === 0) return null;
  return (
    <Section title={title}>
      <List spacing="xs">
        {points.map((point, index) => (
          // Пункты могут повторяться: ключ — номер пункта.
          // oxlint-disable-next-line react/no-array-index-key
          <ListItem key={index}>{point}</ListItem>
        ))}
      </List>
    </Section>
  );
}

export function ApplySection({ vacancy }: DetailsProps): ReactNode {
  const { urls, emails, directMessage } = vacancy.apply;
  return (
    <Section title="Отклик">
      {urls.length === 0 && emails.length === 0 && !directMessage ? (
        <Text c="dimmed">Способ отклика в публикации не указан</Text>
      ) : (
        <Apply vacancy={vacancy} withLabel={false} />
      )}
    </Section>
  );
}

/**
 * Текст публикации как есть, Markdown не разбирается: абзацы — по пустым строкам, внутри
 * абзаца — переносы строк. Без `<pre>`: длинные строки переносятся, а не прокручиваются.
 */
function ContentText({ content }: Readonly<{ content: string }>): ReactNode {
  return (
    <Stack gap="xs">
      {content.split(/\n{2,}/u).map((paragraph, index) => (
        // Абзацы текста не переставляются: ключ — номер абзаца.
        // oxlint-disable-next-line react/no-array-index-key
        <Text key={index} size="sm">
          {paragraph.split('\n').map((line, lineIndex) => (
            // oxlint-disable-next-line react/no-array-index-key
            <span key={lineIndex}>
              {lineIndex === 0 ? null : <br />}
              {line}
            </span>
          ))}
        </Text>
      ))}
    </Stack>
  );
}

/** Публикация, из которой извлечена вакансия, с исходным текстом. */
export function PublicationSection({ vacancy }: DetailsProps): ReactNode {
  return (
    <Section title="Публикация">
      <Publication vacancy={vacancy} />
      {vacancy.authorHeadline === null ? null : (
        <Text size="sm" c="dimmed">
          {vacancy.authorName}: {vacancy.authorHeadline}
        </Text>
      )}
      {vacancy.content === '' ? (
        <Text c="dimmed">Текста нет</Text>
      ) : (
        <Spoiler maxHeight={240} showLabel="Показать весь текст" hideLabel="Свернуть">
          <ContentText content={vacancy.content} />
        </Spoiler>
      )}
    </Section>
  );
}

export function SiblingsSection({ vacancy }: DetailsProps): ReactNode {
  if (vacancy.siblings.length === 0) return null;
  return (
    <Section title="Другие вакансии из публикации">
      <List>
        {vacancy.siblings.map((sibling) => (
          <ListItem key={sibling.id}>
            <Anchor href={`/vacancies/${sibling.id}`}>{sibling.title}</Anchor>
          </ListItem>
        ))}
      </List>
    </Section>
  );
}

export function ServiceSection({ vacancy }: DetailsProps): ReactNode {
  return (
    <Section title="Служебное">
      <Fields>
        <Field label="id">
          <Text ff="monospace" size="sm">
            {vacancy.id}
          </Text>
        </Field>
        <Field label="Профессия (id)">{vacancy.occupationId}</Field>
        <Field label="Номер роли в публикации">{vacancy.position}</Field>
        <Field label="Версия схемы экстрактора">{vacancy.schemaVersion}</Field>
        <Field label="Создана">{dateTimeFormat.format(new Date(vacancy.createdAt))} UTC</Field>
        <Field label="Обновлена">{dateTimeFormat.format(new Date(vacancy.updatedAt))} UTC</Field>
      </Fields>
    </Section>
  );
}
