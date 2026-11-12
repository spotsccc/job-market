#!/usr/bin/env node
// Спайк поиска: как гостевой поиск LinkedIn отвечает на профиль
// «frontend, живу в Аргентине, remote, лучше US‑работодатель».
//
// Без зависимостей, без LLM, без логина. Запуск с домашнего IP (Node 22+):
//   node scripts/spike-search.mjs            # сбор + отчёт (~25 поисковых запросов + ≤60 вакансий, ~8–12 мин)
//   node scripts/spike-search.mjs --offline  # только пересобрать отчёт из сохранённого HTML, без сети
//
// Весь HTML кэшируется в spike-out/raw, поэтому повторный запуск ничего не скачивает заново:
// после блокировки он продолжит с того же места, а после правки парсера достаточно --offline.
// Результат: spike-out/report.md и spike-out/jobs.json.

import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';

// ─── Что проверяем ────────────────────────────────────────────────────────────

const LOCATIONS = {
  ar: 'Argentina',
  latam: 'Latin America',
  ww: 'Worldwide',
  us: 'United States',
};

const KEYWORDS = {
  // как ищет обычный человек
  plain: 'frontend developer',
  // булев запрос по стеку — проверяем, что синтаксис вообще работает и что он даёт сверх plain
  stack: '(frontend OR "front end" OR "front-end") AND (React OR "Next.js" OR TypeScript)',
  // трюк для US/Worldwide: вакансии, где в тексте прямо сказано, что берут из LATAM
  latam: '(frontend OR "front end" OR "front-end" OR React) AND (LATAM OR "Latin America" OR "South America" OR Argentina)',
};

// пары «локация × ключевые слова»
const MATRIX = [
  ['ar', 'plain'], ['ar', 'stack'],
  ['latam', 'plain'], ['latam', 'stack'],
  ['ww', 'stack'], ['ww', 'latam'],
  ['us', 'stack'], ['us', 'latam'],
];

const WINDOW_SECONDS = 7 * 24 * 3600; // f_TPR: вакансии за последнюю неделю
const MAX_PAGES = 3;                   // на пару запрос × локация
const DETAILS_PER_QUERY = 8;           // сколько описаний вакансий тянуть с каждого запроса
const DETAILS_TOTAL = 60;              // общий потолок на страницы вакансий
const PAUSE_MS = [3000, 7000];         // пауза между запросами к LinkedIn

const OUT = path.resolve('spike-out');
const RAW = path.join(OUT, 'raw');
const OFFLINE = process.argv.includes('--offline');

// ─── Сеть с кэшем ─────────────────────────────────────────────────────────────

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const stats = { requests: 0, cached: 0, blocked: 0, errors: 0 };
let aborted = null;
let firstRequest = true;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const exists = (p) => access(p).then(() => true, () => false);

class Blocked extends Error {}

async function get(url, cacheFile) {
  const file = path.join(RAW, cacheFile);
  if (await exists(file)) { stats.cached++; return { status: 200, html: await readFile(file, 'utf8') }; }
  if (OFFLINE || aborted) return null;

  for (let attempt = 0; ; attempt++) {
    if (!firstRequest) await sleep(PAUSE_MS[0] + Math.random() * (PAUSE_MS[1] - PAUSE_MS[0]));
    firstRequest = false;
    stats.requests++;
    let res;
    try {
      res = await fetch(url, { redirect: 'manual', headers: { 'user-agent': UA, 'accept-language': 'en-US,en;q=0.9' } });
    } catch (e) {
      stats.errors++;
      console.warn(`  ! сеть: ${e.message}`);
      return null;
    }
    const blocked = res.status === 429 || res.status === 999 || (res.status >= 300 && res.status < 400);
    if (blocked) {
      stats.blocked++;
      const loc = res.headers.get('location') ?? '';
      console.warn(`  ! блокировка ${res.status} ${loc.slice(0, 80)}`);
      if (attempt === 0) { console.warn('  … жду 60 с'); await sleep(60_000); continue; }
      throw new Blocked(`LinkedIn ответил ${res.status} дважды подряд`);
    }
    const html = await res.text();
    if (res.status === 200) await writeFile(file, html);
    else if (res.status !== 404) { stats.errors++; console.warn(`  ! HTTP ${res.status}`); }
    return { status: res.status, html };
  }
}

// ─── Парсинг ──────────────────────────────────────────────────────────────────

function decode(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}
const text = (html = '') => decode(html.replace(/<br\s*\/?>|<\/(p|li|div|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' '))
  .replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
const pick = (re, s) => { const m = re.exec(s); return m ? text(m[1]) : null; };

function parseSearch(html) {
  const re = /data-entity-urn="urn:li:jobPosting:(\d+)"/g;
  const hits = [...html.matchAll(re)];
  return hits.map((m, i) => {
    const chunk = html.slice(m.index, hits[i + 1]?.index ?? html.length);
    return {
      id: m[1],
      title: pick(/base-search-card__title[^>]*>([\s\S]*?)<\/h3>/, chunk),
      company: pick(/base-search-card__subtitle[^>]*>([\s\S]*?)<\/h4>/, chunk),
      companyUrl: /<a[^>]*hidden-nested-link[^>]*href="([^"?]+)/.exec(chunk)?.[1] ?? null,
      location: pick(/job-search-card__location[^>]*>([\s\S]*?)<\/span>/, chunk),
      postedAt: /<time[^>]*datetime="([^"]+)"/.exec(chunk)?.[1] ?? null,
      salary: pick(/job-search-card__salary-info[^>]*>([\s\S]*?)<\/span>/, chunk),
      url: `https://www.linkedin.com/jobs/view/${m[1]}/`,
    };
  });
}

function parseDetail(html) {
  const criteria = {};
  for (const m of html.matchAll(/description__job-criteria-subheader[^>]*>([\s\S]*?)<\/h3>\s*<span[^>]*>([\s\S]*?)<\/span>/g)) {
    criteria[text(m[1])] = text(m[2]);
  }
  const descHtml = /show-more-less-html__markup[^>]*>([\s\S]*?)<\/div>/.exec(html)?.[1]
    ?? /description__text[^>]*>([\s\S]*?)<\/section>/.exec(html)?.[1] ?? '';
  return {
    description: text(descHtml),
    criteria,
    applicants: pick(/num-applicants__caption[^>]*>([\s\S]*?)<\/(?:span|figcaption)>/, html),
    closed: /No longer accepting applications/i.test(html),
  };
}

// ─── Гео‑сигналы в описании (дёшево, без LLM) ─────────────────────────────────

const SIGNALS = {
  latam: /\b(latam|latin america|south america|argentin[ae]?|buenos aires|am[eé]rica latina|latinoam[eé]rica|nearshore)\b/i,
  anywhere: /\b(work from anywhere|from anywhere in the world|anywhere in the world|location[- ]independent|globally distributed|fully distributed|remote[- ]first,? (?:global|worldwide)|hire (?:globally|worldwide)|any time ?zone)\b/i,
  contractor: /\b(independent contractor|contractor basis|deel|remote\.com|ontop|oyster hr|employer of record|\beor\b)\b/i,
  usOnly: /(must (?:be|reside|live|currently reside)(?: located| based)? (?:in|within) the (?:us|u\.s\.|usa|united states)|(?:us|u\.s\.)[- ]based (?:candidates|applicants|only)|(?:legally )?authori[sz]ed to work in the (?:us|u\.s\.|usa|united states)|eligible to work in the (?:us|u\.s\.|united states)|\bus citizens?(?:hip)?\b|green card|\bw-?2\b|security clearance|(?:us|usa|u\.s\.) only\b|remote \((?:us|usa)\)|within the (?:continental )?(?:us|united states))/i,
  otherCountryOnly: /(must (?:be|reside|live)(?: located| based)? in (?!the (?:us|u\.s\.|usa|united states))(?:the )?(canada|uk|united kingdom|europe|the eu|germany|spain|portugal|poland|india|brazil|mexico|colombia|australia|israel)\b)/i,
  usTimezone: /\b(est|edt|pst|pdt|cst|eastern(?: standard)? time|pacific(?: standard)? time|us (?:business )?hours|us time ?zones?)\b/i,
  usd: /(\$\s?\d|\busd\b)/i,
};

function snippet(re, s) {
  const m = re.exec(s);
  if (!m) return null;
  const a = Math.max(0, m.index - 70), b = Math.min(s.length, m.index + m[0].length + 70);
  return (a > 0 ? '…' : '') + s.slice(a, b).replace(/\s+/g, ' ') + (b < s.length ? '…' : '');
}

function classify(job) {
  const s = `${job.title}\n${job.description ?? ''}`; // локация оценивается отдельно, см. ok-by-location
  const found = Object.fromEntries(Object.entries(SIGNALS).map(([k, re]) => [k, snippet(re, s)]).filter(([, v]) => v));
  let verdict;
  if (job.closed) verdict = 'closed';
  else if (found.usOnly && !found.latam && !found.anywhere) verdict = 'us-only';
  else if (found.otherCountryOnly && !found.latam && !found.anywhere) verdict = 'other-country-only';
  else if (found.latam || found.anywhere) verdict = 'ok';
  else if (/argentin|latin|south america|latam/i.test(job.location ?? '')) verdict = 'ok-by-location';
  else if (found.contractor) verdict = 'likely';
  else verdict = 'unclear';
  const usEmployerHints = ['usTimezone', 'usd', 'usOnly'].filter((k) => found[k]);
  return { verdict, signals: found, usEmployerHints };
}

// ─── Прогон ───────────────────────────────────────────────────────────────────

function searchUrl(loc, kw, start) {
  const p = new URLSearchParams({
    keywords: kw, location: loc, f_WT: '2', f_TPR: `r${WINDOW_SECONDS}`, sortBy: 'DD', start: String(start),
  });
  return `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?${p}`;
}

async function main() {
  await mkdir(RAW, { recursive: true });
  const jobs = new Map();      // id → job
  const queries = [];

  for (const [locKey, kwKey] of MATRIX) {
    const q = { id: `${locKey}-${kwKey}`, location: LOCATIONS[locKey], keywords: KEYWORDS[kwKey], pages: [], ids: [] };
    queries.push(q);
    console.log(`\n▶ ${q.id}: ${q.location} | ${q.keywords}`);
    let start = 0;
    for (let page = 0; page < MAX_PAGES; page++) {
      let res;
      try { res = await get(searchUrl(q.location, q.keywords, start), `search_${q.id}_${start}.html`); }
      catch (e) { if (e instanceof Blocked) { aborted = e.message; break; } throw e; }
      if (!res) break;
      const cards = res.status === 200 ? parseSearch(res.html) : [];
      q.pages.push({ start, status: res.status, bytes: res.html.length, cards: cards.length });
      console.log(`  start=${start} → HTTP ${res.status}, ${cards.length} карточек`);
      if (res.status === 200 && res.html.length > 2000 && cards.length === 0) {
        console.warn('  ! HTML есть, а карточек 0 — похоже, поменялась вёрстка. Сырой ответ в spike-out/raw.');
      }
      for (const c of cards) {
        if (!jobs.has(c.id)) jobs.set(c.id, { ...c, foundBy: [] });
        const j = jobs.get(c.id);
        if (!j.foundBy.includes(q.id)) j.foundBy.push(q.id);
        if (!q.ids.includes(c.id)) q.ids.push(c.id);
      }
      if (cards.length === 0) break;
      start += cards.length;
    }
  }

  // описания: первые N вакансий из каждого запроса, без повторов
  let budget = DETAILS_TOTAL;
  const detailIds = new Set();
  for (const q of queries) for (const id of q.ids.filter((id) => !detailIds.has(id)).slice(0, DETAILS_PER_QUERY)) {
    if (budget-- <= 0) break;
    detailIds.add(id);
  }
  console.log(`\n▶ Описания вакансий: ${detailIds.size}`);
  for (const id of detailIds) {
    let res;
    try { res = await get(`https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${id}`, `job_${id}.html`); }
    catch (e) { if (e instanceof Blocked) { aborted = e.message; break; } throw e; }
    if (!res) continue;
    const j = jobs.get(id);
    if (res.status === 404) { j.closed = true; j.detailFetched = true; }
    else if (res.status === 200) Object.assign(j, parseDetail(res.html), { detailFetched: true });
    if (j.detailFetched) Object.assign(j, classify(j));
    process.stdout.write(j.verdict ? `${j.verdict[0]}` : '.');
  }
  console.log();

  const all = [...jobs.values()];
  await writeFile(path.join(OUT, 'jobs.json'), JSON.stringify({ queries, jobs: all, stats, aborted }, null, 2));
  await writeFile(path.join(OUT, 'report.md'), report(queries, all));
  console.log(`\nГотово: spike-out/report.md, spike-out/jobs.json`);
  console.log(`Запросов: ${stats.requests}, из кэша: ${stats.cached}, блокировок: ${stats.blocked}, ошибок: ${stats.errors}${aborted ? `\nОСТАНОВЛЕНО: ${aborted}. Запусти позже ещё раз — продолжит из кэша.` : ''}`);
}

// ─── Отчёт ────────────────────────────────────────────────────────────────────

const VERDICTS = ['ok', 'ok-by-location', 'likely', 'unclear', 'us-only', 'other-country-only', 'closed'];
const VERDICT_RU = {
  ok: '✅ прямо сказано LATAM/Argentina/anywhere',
  'ok-by-location': '✅ локация вакансии — LATAM/Argentina',
  likely: '🟡 контрактор/EOR, гео не сказано',
  unclear: '❔ гео не сказано',
  'us-only': '⛔ только US',
  'other-country-only': '⛔ только другая страна',
  closed: '— закрыта',
};
const md = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

function countBy(arr, f) {
  const m = new Map();
  for (const x of arr) { const k = f(x) ?? '—'; m.set(k, (m.get(k) ?? 0) + 1); }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

function report(queries, all) {
  const byId = new Map(all.map((j) => [j.id, j]));
  const L = [];
  L.push(`# Спайк поиска: frontend · remote · из Аргентины`, '');
  L.push(`Окно: последние ${WINDOW_SECONDS / 86400} дн., f_WT=2 (remote), до ${MAX_PAGES} страниц на запрос. Сгенерировано ${new Date().toISOString()}.`);
  L.push(`Запросов к LinkedIn: ${stats.requests}, из кэша: ${stats.cached}, блокировок: ${stats.blocked}, ошибок: ${stats.errors}.`);
  if (aborted) L.push('', `> ⚠️ Прогон остановлен: ${aborted}. Данные неполные — перезапусти позже, кэш сохранится.`);

  const pageSizes = [...new Set(queries.flatMap((q) => q.pages.filter((p) => p.cards).map((p) => p.cards)))];
  L.push('', `Размер страницы (наблюдаемый): ${pageSizes.join(', ') || '—'}. Уникальных вакансий всего: ${all.length}.`);

  L.push('', '## 1. Запросы', '');
  L.push('| Запрос | Карточек | Только этот запрос | С описанием | ✅ можно из AR | ⛔ нельзя | ❔ неясно | Топ локаций в выдаче |');
  L.push('|---|---|---|---|---|---|---|---|');
  for (const q of queries) {
    const js = q.ids.map((id) => byId.get(id));
    const only = js.filter((j) => j.foundBy.length === 1).length;
    const d = js.filter((j) => j.verdict);
    const ok = d.filter((j) => j.verdict.startsWith('ok') || j.verdict === 'likely').length;
    const bad = d.filter((j) => j.verdict.endsWith('-only')).length;
    const unk = d.filter((j) => j.verdict === 'unclear').length;
    const locs = countBy(js, (j) => j.location).slice(0, 3).map(([k, n]) => `${k} (${n})`).join('; ');
    L.push(`| \`${q.id}\` | ${js.length} | ${only} | ${d.length} | ${ok} | ${bad} | ${unk} | ${md(locs)} |`);
  }
  L.push('', 'Ключевые слова:', '');
  for (const [k, v] of Object.entries(KEYWORDS)) L.push(`- \`${k}\`: \`${v}\``);

  L.push('', '## 2. Пересечения запросов', '');
  L.push('Сколько вакансий запроса в строке нашёл и запрос в столбце.', '');
  L.push(`| | ${queries.map((q) => `\`${q.id}\``).join(' | ')} |`);
  L.push(`|---|${queries.map(() => '---').join('|')}|`);
  for (const a of queries) {
    const sa = new Set(a.ids);
    L.push(`| \`${a.id}\` | ${queries.map((b) => (a === b ? `**${a.ids.length}**` : b.ids.filter((id) => sa.has(id)).length)).join(' | ')} |`);
  }

  const detailed = all.filter((j) => j.verdict);
  L.push('', `## 3. Можно ли работать из Аргентины (${detailed.length} вакансий с описанием)`, '');
  L.push('Эвристика по регуляркам, без LLM: ищет в тексте LATAM/Argentina/anywhere, «только US», контрактор/EOR. Цитаты ниже — чтобы проверить глазами.', '');
  for (const [v, n] of countBy(detailed, (j) => j.verdict).sort((a, b) => VERDICTS.indexOf(a[0]) - VERDICTS.indexOf(b[0]))) {
    L.push(`- ${VERDICT_RU[v] ?? v}: **${n}**`);
  }
  const usHint = detailed.filter((j) => j.usEmployerHints?.length && !j.verdict.endsWith('-only') && j.verdict !== 'closed');
  L.push('', `Подходящие или неясные с признаками US‑работодателя (USD, US‑таймзона): **${usHint.length}**.`);

  for (const v of VERDICTS) {
    const group = detailed.filter((j) => j.verdict === v);
    if (!group.length) continue;
    L.push('', `### ${VERDICT_RU[v]} (${group.length})`, '');
    for (const j of group) {
      const meta = [j.location, j.postedAt, j.criteria?.['Seniority level'], j.criteria?.['Employment type'], j.applicants, j.salary].filter(Boolean).join(' · ');
      L.push(`- **[${md(j.title)}](${j.url})** — ${md(j.company)} · ${md(meta)}  `);
      L.push(`  нашли: ${j.foundBy.map((x) => `\`${x}\``).join(', ')}${j.usEmployerHints?.length ? ` · US‑признаки: ${j.usEmployerHints.join(', ')}` : ''}`);
      for (const k of ['usOnly', 'otherCountryOnly', 'latam', 'anywhere', 'contractor']) {
        if (j.signals?.[k]) L.push(`  - ${k}: _${md(j.signals[k])}_`);
      }
    }
  }

  L.push('', '## 4. Все карточки без описания', '');
  L.push('| Название | Компания | Локация | Дата | Нашли |', '|---|---|---|---|---|');
  for (const j of all.filter((j) => !j.detailFetched)) {
    L.push(`| [${md(j.title)}](${j.url}) | ${md(j.company)} | ${md(j.location)} | ${j.postedAt ?? ''} | ${j.foundBy.join(', ')} |`);
  }
  return L.join('\n') + '\n';
}

main().catch((e) => { console.error(e); process.exit(1); });
