import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';

import { GeonamesDownloadError } from '../errors/index.ts';
import { downloadGeonames } from './download.ts';

const BODY = 'AU\tAUS\n';

let mode: 'full' | 'truncated' = 'full';
let requests = 0;

const server = createServer((_request, response) => {
  requests += 1;
  if (mode === 'full') {
    response.writeHead(200, { 'content-length': Buffer.byteLength(BODY) }).end(BODY);
    return;
  }
  // Обещаем 1 000 байт, отдаём 10 и рвём соединение — как оборванная загрузка в Э0.
  response.writeHead(200, { 'content-length': 1000 });
  response.write('0123456789');
  setTimeout(() => {
    response.destroy();
  }, 10);
});

let baseUrl = '';
let cacheDir = '';

before(async () => {
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address !== null && typeof address === 'object');
  const { port } = address;
  baseUrl = `http://127.0.0.1:${String(port)}/`;
});

after(() => {
  server.close();
});

beforeEach(async () => {
  mode = 'full';
  requests = 0;
  cacheDir = await mkdtemp(join(tmpdir(), 'geonames-cache-'));
});

describe('downloadGeonames', () => {
  test('a broken download is an error and leaves nothing in the cache', async () => {
    mode = 'truncated';
    const result = await downloadGeonames(['countryInfo.txt'], {
      cacheDir,
      baseUrl,
      refresh: false,
    });
    assert.ok(result instanceof GeonamesDownloadError);
    assert.equal(result.file, 'countryInfo.txt');
    assert.deepEqual(await readdir(cacheDir), []);
    await rm(cacheDir, { recursive: true });
  });

  test('a file already in the cache is not downloaded again', async () => {
    await writeFile(join(cacheDir, 'countryInfo.txt'), 'cached');
    const result = await downloadGeonames(['countryInfo.txt'], {
      cacheDir,
      baseUrl,
      refresh: false,
    });
    assert.deepEqual(result, [join(cacheDir, 'countryInfo.txt')]);
    assert.equal(requests, 0);
    await rm(cacheDir, { recursive: true });
  });

  test('refresh downloads the file again', async () => {
    const path = join(cacheDir, 'countryInfo.txt');
    await writeFile(path, 'cached');
    const result = await downloadGeonames(['countryInfo.txt'], {
      cacheDir,
      baseUrl,
      refresh: true,
    });
    assert.deepEqual(result, [path]);
    assert.equal(requests, 1);
    assert.equal(await readFile(path, 'utf8'), BODY);
    await rm(cacheDir, { recursive: true });
  });
});
