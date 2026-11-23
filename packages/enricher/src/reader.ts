/**
 * Читатель знает один вид страниц: какие ссылки его, как прочитать их пачкой и что
 * дописать в раздел. Енричер про сайты не знает — новый сайт добавляется новым читателем.
 */
export type Reader = {
  /** Имя читателя в сбоях и логах: `linkedin-job`. */
  readonly kind: string;
  /** Вид страницы в заголовке раздела: «Вакансия LinkedIn». */
  readonly label: string;
  /** Id страницы, если ссылка этого читателя, иначе `null`. */
  readonly parseUrl: (url: string) => string | null;
  /**
   * Читает страницы пачкой: id → тело раздела. Id, которого нет в ответе, — «нет данных»:
   * страницы нет или читать нечего. Ошибка — сбой всех id пачки.
   */
  readonly fetch: (ids: readonly string[]) => Promise<Error | ReadonlyMap<string, string>>;
};
