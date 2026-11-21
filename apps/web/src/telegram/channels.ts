/**
 * Каналы, которые собирает краулер: набор каналов-агрегаторов вакансий geekjobs.
 * Все публичные, с включённым веб-превью `t.me/s/<канал>`. Юзернеймы в нижнем
 * регистре, без `@`. Новый канал — строка здесь: первый прогон соберёт его на
 * всю глубину сбора.
 */
export const TELEGRAM_CHANNELS = [
  'forallsales',
  'fordesigner',
  'forproducts',
  'forallmedia',
  'forhr',
  'forproducer',
  'remotegeekjob',
  'geekjobs',
  'jobforjunior',
  'forchiefs',
  'jobfortm',
  'forallmarketing',
  'jobforpr',
  'forgamedev',
] as const;

/** Глубина сбора: первый проход берёт сообщения за столько дней, дальше — только новые. */
export const CRAWL_DEPTH_DAYS = 30;
