import { Anchor, Container, Divider, Stack, Text } from '@mantine/core';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Гео — job-market',
};

export default function GeoLayout({ children }: Readonly<{ children: ReactNode }>): ReactNode {
  return (
    <Container component="main" size="xl" py="xl">
      <Stack gap="xl">
        {children}
        <Divider />
        {/* П16: данные GeoNames — CC BY 4.0, ссылка на каждой странице с гео-данными. */}
        <Text component="footer" size="sm" c="dimmed">
          Страны, города и их названия — из{' '}
          <Anchor href="https://www.geonames.org/" size="sm">
            GeoNames
          </Anchor>
          , лицензия{' '}
          <Anchor href="https://creativecommons.org/licenses/by/4.0/" size="sm">
            CC BY 4.0
          </Anchor>
          . Названия стран — из CLDR. Регионы найма и ручные названия — наши.
        </Text>
      </Stack>
    </Container>
  );
}
