import Link from 'next/link';
import type { ReactNode } from 'react';

export default function HomePage(): ReactNode {
  return (
    <main>
      <h1>job-market</h1>
      <Link href="/linkedin">Поиск постов LinkedIn</Link>
    </main>
  );
}
