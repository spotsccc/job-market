import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';

import { tryAsync } from '@spotsccc/error-as-value';

import { GeonamesDownloadError } from '../errors/index.ts';

/** Откуда качаются дампы GeoNames. */
export const GEONAMES_DUMP_URL = 'https://download.geonames.org/export/dump/';

/** Файлы дампа, которые нужны генератору. */
export const GEONAMES_FILES = [
  'countryInfo.txt',
  'cities15000.zip',
  'alternateNamesV2.zip',
] as const;
export type GeonamesFile = (typeof GEONAMES_FILES)[number];

export type DownloadOptions = {
  /** Каталог кэша: `packages/geo/node_modules/.cache/geonames`. */
  readonly cacheDir: string;
  /** Адрес каталога с дампами, со слэшем в конце. */
  readonly baseUrl: string;
  /** Качать заново, даже если файл уже в кэше. */
  readonly refresh: boolean;
};

/**
 * Кладёт файлы в кэш и возвращает их пути в том же порядке. Файл, который уже есть в
 * кэше, не качается, если не задан `refresh`. Загрузка идёт во временный файл и
 * переименовывается, только когда длина совпала с `Content-Length`: оборванная загрузка
 * не оставляет в кэше половину файла.
 */
export async function downloadGeonames(
  files: readonly GeonamesFile[],
  options: DownloadOptions,
): Promise<GeonamesDownloadError | string[]> {
  const created = await mkdir(options.cacheDir, { recursive: true }).catch(
    (cause: unknown) => new GeonamesDownloadError({ file: options.cacheDir, cause }),
  );
  if (created instanceof Error) return created;

  const results = await Promise.all(
    files.map(async (file) => {
      const path = join(options.cacheDir, file);
      if (!options.refresh && (await isFile(path))) return path;
      const downloaded = await downloadFile(new URL(file, options.baseUrl).href, path, file);
      return downloaded ?? path;
    }),
  );
  const paths: string[] = [];
  for (const result of results) {
    if (result instanceof Error) return result;
    paths.push(result);
  }
  return paths;
}

async function isFile(path: string): Promise<boolean> {
  const info = await stat(path).catch(() => null);
  return info?.isFile() ?? false;
}

async function downloadFile(
  url: string,
  path: string,
  file: GeonamesFile,
): Promise<GeonamesDownloadError | undefined> {
  const partial = `${path}.part`;
  const result = await tryAsync(
    async () => {
      const response = await fetch(url);
      if (!response.ok || response.body === null) {
        throw new Error(`GET ${url} answered ${String(response.status)}`);
      }
      const expected = Number(response.headers.get('content-length'));
      // fetch отдаёт веб-поток, pipeline ждёт поток Node: тип из node:stream/web совместим.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- тот же поток, другой тип в lib.dom
      const body = Readable.fromWeb(response.body as WebReadableStream<Uint8Array>);
      await pipeline(body, createWriteStream(partial));
      const { size } = await stat(partial);
      if (Number.isFinite(expected) && expected > 0 && size !== expected) {
        throw new Error(`Got ${String(size)} bytes of ${String(expected)}`);
      }
      await rename(partial, path);
    },
    (cause: unknown) => new GeonamesDownloadError({ file, cause }),
  );
  if (result instanceof Error) {
    await rm(partial, { force: true });
    return result;
  }
  return undefined;
}
