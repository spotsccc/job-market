/**
 * Пишет JSON дашбордов в `dist/`. Локальная Grafana читает эту папку (compose.yaml), в Grafana Cloud
 * её выгружает grafanactl.
 */
import { mkdir, writeFile } from 'node:fs/promises';

import { engineDashboard } from './engine.ts';

const out = new URL('../dist/', import.meta.url);
await mkdir(out, { recursive: true });
await writeFile(new URL('engine.json', out), `${JSON.stringify(engineDashboard(), null, 2)}\n`);
