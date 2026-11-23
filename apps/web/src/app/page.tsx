import { Anchor, Container, Stack, Title } from '@mantine/core';
import type { ReactNode } from 'react';

export default function HomePage(): ReactNode {
  return (
    <Container component="main" size="md" py="xl">
      <Title order={1} mb="lg">
        job-market
      </Title>
      <Stack gap="xs">
        <Anchor href="/vacancies">Вакансии</Anchor>
      </Stack>
    </Container>
  );
}
