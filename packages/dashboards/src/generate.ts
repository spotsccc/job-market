/**
 * Пишет JSON дашбордов в `dist/`. Его читает только локальная Grafana (compose.yaml, provisioning из
 * файлов): дашборд никуда не выгружается.
 */
import { mkdir, writeFile } from 'node:fs/promises';

import { engineDashboard } from './engine.ts';

const out = new URL('../dist/', import.meta.url);
await mkdir(out, { recursive: true });
await writeFile(new URL('engine.json', out), `${JSON.stringify(engineDashboard(), null, 2)}\n`);
