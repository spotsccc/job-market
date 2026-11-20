import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'job-market',
  description: 'Сбор и разбор вакансий под профиль',
};

type RootLayoutProps = Readonly<{
  children: ReactNode;
}>;

export default function RootLayout({ children }: RootLayoutProps): ReactNode {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
