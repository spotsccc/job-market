'use client';

import {
  Alert,
  Anchor,
  Badge,
  Button,
  Divider,
  Group,
  NativeSelect,
  NumberInput,
  Stack,
  Text,
  Textarea,
} from '@mantine/core';
import { Fragment, startTransition, useActionState, useCallback } from 'react';
import type { ReactNode, SubmitEvent } from 'react';

import { searchLinkedinPosts } from './actions.ts';
import { INITIAL_SEARCH_STATE, MAX_POSTS_LIMIT } from './search-state.ts';
import type { PostVerdictView, PostView, SearchState } from './search-state.ts';

const dateFormat = new Intl.DateTimeFormat('ru', { dateStyle: 'medium', timeStyle: 'short' });

const POSTED_LIMIT_OPTIONS = [
  { value: '', label: 'любое время' },
  { value: '1h', label: 'час' },
  { value: '24h', label: 'сутки' },
  { value: 'week', label: 'неделю' },
  { value: 'month', label: 'месяц' },
];

const SORT_BY_OPTIONS = [
  { value: '', label: 'по умолчанию актора' },
  { value: 'relevance', label: 'по релевантности' },
  { value: 'date', label: 'сначала новые' },
];

function Verdict({ verdict }: Readonly<{ verdict: PostVerdictView }>): ReactNode {
  if (verdict.status === 'error') {
    return (
      <Badge color="red" variant="light">
        не удалось разобрать
      </Badge>
    );
  }
  if (verdict.status === 'duplicate') {
    return (
      <Badge color="gray" variant="light">
        уже в базе
      </Badge>
    );
  }
  if (verdict.status === 'not_vacancy') {
    return (
      <Group gap="xs">
        <Badge color="gray" variant="light">
          не вакансия
        </Badge>
        <Text size="sm" c="dimmed">
          {verdict.note}
        </Text>
      </Group>
    );
  }
  return (
    <Group gap="xs">
      <Badge color="green" variant="light">
        вакансия
      </Badge>
      <Text size="sm">{verdict.titles.join(', ')}</Text>
    </Group>
  );
}

function PostItem({ post }: Readonly<{ post: PostView }>): ReactNode {
  return (
    <Stack gap="xs">
      <Verdict verdict={post.verdict} />
      <Text>
        <Anchor href={post.authorUrl} target="_blank" rel="noreferrer" fw={700}>
          {post.authorName}
        </Anchor>
        {post.authorHeadline === null ? null : ` — ${post.authorHeadline}`}
      </Text>
      <Text size="sm" c="dimmed">
        {dateFormat.format(new Date(post.postedAt))} ·{' '}
        <Anchor href={post.url} target="_blank" rel="noreferrer" inherit>
          открыть пост
        </Anchor>
      </Text>
      {post.content === '' ? (
        <Text fs="italic" c="dimmed">
          без текста
        </Text>
      ) : (
        <Text>
          {post.content.split('\n').map((line, index) => (
            // Строки текста не переупорядочиваются, индекс — стабильный ключ.
            // oxlint-disable-next-line react/no-array-index-key
            <Fragment key={index}>
              {index === 0 ? null : <br />}
              {line}
            </Fragment>
          ))}
        </Text>
      )}
    </Stack>
  );
}

function Result({ state }: Readonly<{ state: SearchState }>): ReactNode {
  if (state.status === 'idle') return null;
  if (state.status === 'error') {
    return (
      <Alert color="red" title="Ошибка" role="alert">
        {state.message}
      </Alert>
    );
  }
  return (
    <Stack gap="md">
      <Text>
        Найдено постов: {state.posts.length} за {(state.elapsedMs / 1000).toFixed(0)} с, сохранено
        вакансий: {state.savedVacancies}
        {state.failedPosts === 0
          ? null
          : `, не удалось разобрать постов: ${String(state.failedPosts)}`}
      </Text>
      {state.posts.map((post) => (
        <Fragment key={post.id}>
          <Divider />
          <PostItem post={post} />
        </Fragment>
      ))}
    </Stack>
  );
}

function SearchFields(): ReactNode {
  return (
    <>
      <Textarea
        name="queries"
        label="Запросы, по одному на строку"
        rows={4}
        required
        defaultValue="frontend developer remote"
      />
      <NumberInput
        name="maxPosts"
        label="Постов на запрос"
        min={1}
        max={MAX_POSTS_LIMIT}
        allowDecimal={false}
        allowNegative={false}
        defaultValue={10}
        required
      />
      <NativeSelect
        name="postedLimit"
        label="Опубликованы за"
        data={POSTED_LIMIT_OPTIONS}
        defaultValue="week"
      />
      <NativeSelect name="sortBy" label="Сортировка" data={SORT_BY_OPTIONS} defaultValue="date" />
    </>
  );
}

export function SearchForm(): ReactNode {
  const [state, formAction, isPending] = useActionState(searchLinkedinPosts, INITIAL_SEARCH_STATE);

  // Не `action={formAction}`: тогда React сбрасывает форму после отправки, а введённое нужно сохранить.
  const handleSubmit = useCallback(
    (event: SubmitEvent<HTMLFormElement>): void => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      startTransition(() => {
        formAction(formData);
      });
    },
    [formAction],
  );

  return (
    <Stack gap="xl">
      <form onSubmit={handleSubmit}>
        <Stack gap="md" maw={560}>
          <SearchFields />
          <Group>
            <Button type="submit" loading={isPending}>
              Искать
            </Button>
          </Group>
          {isPending ? (
            <Text size="sm" c="dimmed">
              Ищем и разбираем посты… запуск актора занимает до пары минут
            </Text>
          ) : null}
        </Stack>
      </form>
      <Result state={state} />
    </Stack>
  );
}
