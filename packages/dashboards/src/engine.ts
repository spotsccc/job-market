// Схема дашборда v1, а не dashboardv2: v1 читают provisioning из файлов и любая версия Grafana.
// oxlint-disable typescript/no-deprecated
import type * as cog from '@grafana/grafana-foundation-sdk/cog';
import {
  StackingConfigBuilder,
  GraphDrawStyle,
  StackingMode,
} from '@grafana/grafana-foundation-sdk/common';
import {
  DashboardBuilder,
  QueryVariableBuilder,
  RowBuilder,
  VariableRefresh,
} from '@grafana/grafana-foundation-sdk/dashboard';
import type { Dashboard } from '@grafana/grafana-foundation-sdk/dashboard';
import { PanelBuilder as TablePanelBuilder } from '@grafana/grafana-foundation-sdk/table';
import { PanelBuilder as TimeseriesPanelBuilder } from '@grafana/grafana-foundation-sdk/timeseries';

/**
 * Источник данных — база прода на Neon (docker/grafana/provisioning/datasources/neon.yaml). Он
 * один: Grafana работает только локально и читает только прод.
 */
const NEON = { type: 'grafana-postgresql-datasource', uid: 'job-market-neon' } as const;

/** Вид события `monitoring.events` (packages/db/src/monitoring/README.md). */
type EventKind =
  | 'publication'
  | 'vacancy'
  | 'parse_error'
  | 'link_error'
  | 'duplicate'
  | 'vacancy_duplicate'
  | 'not_vacancy'
  | 'extraction_error';

/**
 * SQL-запрос к Neon. В SDK нет типа запроса PostgreSQL, поэтому объект — как его сохраняет
 * редактор Grafana в режиме кода.
 */
function query(rawSql: string, format: 'time_series' | 'table'): cog.Builder<cog.Dataquery> {
  return {
    build: () => ({
      refId: 'A',
      datasource: NEON,
      editorMode: 'code',
      rawQuery: true,
      format,
      rawSql,
      _implementsDataqueryVariant: () => {},
    }),
  };
}

/** События вида `kind` за период дашборда по выбранным площадкам и источникам. */
const filter = (kind: EventKind): string =>
  `kind = '${kind}' AND $__timeFilter(at) AND platform IN ($platform) AND source_id IN ($source)`;

/** Столбцы по дням стопкой по площадкам. Сутки — по UTC, как и часовой пояс дашборда. */
function byDay(title: string, kind: EventKind): TimeseriesPanelBuilder {
  return new TimeseriesPanelBuilder()
    .title(title)
    .datasource(NEON)
    .withTarget(
      query(
        `SELECT $__timeGroupAlias(at, '1d'), platform AS metric, count(*) AS value
FROM monitoring.events
WHERE ${filter(kind)}
GROUP BY 1, 2
ORDER BY 1`,
        'time_series',
      ),
    )
    .drawStyle(GraphDrawStyle.Bars)
    .fillOpacity(80)
    .stacking(new StackingConfigBuilder().mode(StackingMode.Normal))
    .decimals(0)
    .min(0)
    .height(8)
    .span(12);
}

/** Таблица того же показателя по источникам за период. */
function bySource(title: string, kind: EventKind, span: number): TablePanelBuilder {
  return new TablePanelBuilder()
    .title(title)
    .datasource(NEON)
    .withTarget(
      query(
        `SELECT source AS "Источник", platform AS "Площадка", count(*) AS "Всего"
FROM monitoring.events
WHERE ${filter(kind)}
GROUP BY 1, 2
ORDER BY 3 DESC, 1`,
        'table',
      ),
    )
    .height(8)
    .span(span);
}

/** Разбивка показателя по `detail`: хосты ссылок, причины не вакансий. */
function byDetail(title: string, kind: EventKind, column: string): TablePanelBuilder {
  return new TablePanelBuilder()
    .title(title)
    .datasource(NEON)
    .withTarget(
      query(
        `SELECT detail AS "${column}", count(*) AS "Всего"
FROM monitoring.events
WHERE ${filter(kind)}
GROUP BY 1
ORDER BY 2 DESC, 1`,
        'table',
      ),
    )
    .height(8)
    .span(6);
}

/** Последние 20 событий с подробностью: текст ошибки, название роли. */
function latest(title: string, kind: EventKind, column: string): TablePanelBuilder {
  return new TablePanelBuilder()
    .title(title)
    .datasource(NEON)
    .withTarget(
      query(
        `SELECT at AS "Время", source AS "Источник", platform AS "Площадка", detail AS "${column}"
FROM monitoring.events
WHERE ${filter(kind)}
ORDER BY at DESC
LIMIT 20`,
        'table',
      ),
    )
    .height(8)
    .span(24);
}

/** Переменная с выбором нескольких значений, по умолчанию — все. */
function multiVariable(name: string, label: string, sql: string): QueryVariableBuilder {
  return new QueryVariableBuilder(name)
    .label(label)
    .datasource(NEON)
    .query(sql)
    .definition(sql)
    .multi(true)
    .includeAll(true)
    .current({ text: 'All', value: '$__all' })
    .refresh(VariableRefresh.OnDashboardLoad);
}

/**
 * Дашборд «Движок» (docs/plans/monitoring.html): пять разделов — спаршенное, ошибки парсинга,
 * дубли, не вакансии, ошибки экстракции. Переменные площадки и источника общие для всех панелей.
 * Сутки считаются по UTC, сам дашборд не обновляется: каждый запрос будит Neon (П12 плана).
 */
export function engineDashboard(): Dashboard {
  return new DashboardBuilder('Движок')
    .uid('job-market-engine')
    .tags(['job-market'])
    .timezone('utc')
    .time({ from: 'now-7d', to: 'now' })
    .refresh('')
    .withVariable(
      multiVariable(
        'platform',
        'Площадка',
        'SELECT DISTINCT platform FROM monitoring.sources ORDER BY 1',
      ),
    )
    .withVariable(
      multiVariable(
        'source',
        'Источник',
        'SELECT name AS __text, id AS __value FROM monitoring.sources WHERE platform IN ($platform) ORDER BY 1',
      ),
    )
    .withRow(new RowBuilder('Спаршенное'))
    .withPanel(byDay('Новые публикации', 'publication'))
    .withPanel(bySource('Новые публикации по источникам', 'publication', 12))
    .withPanel(byDay('Вакансии', 'vacancy'))
    .withPanel(bySource('Вакансии по источникам', 'vacancy', 12))
    .withRow(new RowBuilder('Ошибки парсинга'))
    .withPanel(byDay('Упавшие опросы', 'parse_error'))
    .withPanel(bySource('Упавшие опросы по источникам', 'parse_error', 12))
    .withPanel(latest('Последние ошибки опросов', 'parse_error', 'Ошибка'))
    .withPanel(byDay('Непрочитанные ссылки', 'link_error'))
    .withPanel(bySource('Непрочитанные ссылки по источникам', 'link_error', 6))
    .withPanel(byDetail('Непрочитанные ссылки по хостам', 'link_error', 'Хост'))
    .withRow(new RowBuilder('Дубли'))
    .withPanel(byDay('Дубли публикаций', 'duplicate'))
    .withPanel(bySource('Дубли публикаций по источникам', 'duplicate', 12))
    .withPanel(byDay('Дубли вакансий', 'vacancy_duplicate'))
    .withPanel(bySource('Дубли вакансий по источникам', 'vacancy_duplicate', 12))
    .withPanel(latest('Последние дубли вакансий', 'vacancy_duplicate', 'Роль'))
    .withRow(new RowBuilder('Не вакансии'))
    .withPanel(byDay('Не вакансии', 'not_vacancy'))
    .withPanel(bySource('Не вакансии по источникам', 'not_vacancy', 6))
    .withPanel(byDetail('Не вакансии по причинам', 'not_vacancy', 'Причина'))
    .withRow(new RowBuilder('Ошибки экстракции'))
    .withPanel(byDay('Ошибки экстракции', 'extraction_error'))
    .withPanel(bySource('Ошибки экстракции по источникам', 'extraction_error', 12))
    .withPanel(latest('Последние ошибки экстракции', 'extraction_error', 'Ошибка'))
    .build();
}
