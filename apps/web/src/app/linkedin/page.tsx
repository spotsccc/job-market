import { Container, Title } from '@mantine/core';
import type { ReactNode } from 'react';

import { SearchForm } from './search-form.tsx';

export default function LinkedinPage(): ReactNode {
  return (
    <Container component="main" size="md" py="xl">
      <Title order={1} mb="lg">
        Поиск постов LinkedIn
      </Title>
      <SearchForm />
    </Container>
  );
}
