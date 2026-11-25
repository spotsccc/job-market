// Схема дашборда v1, а не dashboardv2: v1 читают provisioning из файлов, импорт и любая версия Grafana.
// oxlint-disable typescript/no-deprecated
import {
  DashboardBuilder,
  DatasourceVariableBuilder,
} from '@grafana/grafana-foundation-sdk/dashboard';
import type { Dashboard } from '@grafana/grafana-foundation-sdk/dashboard';
import { PanelBuilder as TextPanelBuilder, TextMode } from '@grafana/grafana-foundation-sdk/text';

/** Тип источника данных PostgreSQL в Grafana. */
const POSTGRES = 'grafana-postgresql-datasource';

/**
 * Дашборд «Движок» (docs/plans/monitoring.html). Источник данных выбирает переменная `datasource`:
 * у локальной Grafana и у Grafana Cloud свои uid, а дашборд один. Сутки считаются по UTC, сам
 * дашборд не обновляется: каждый запрос будит Neon (П12 плана).
 */
export function engineDashboard(): Dashboard {
  return new DashboardBuilder('Движок')
    .uid('job-market-engine')
    .tags(['job-market'])
    .timezone('utc')
    .time({ from: 'now-7d', to: 'now' })
    .refresh('')
    .withVariable(new DatasourceVariableBuilder('datasource').label('База').type(POSTGRES))
    .withPanel(
      new TextPanelBuilder()
        .title('Движок')
        .mode(TextMode.Markdown)
        .content(
          'Панели появятся, когда в базе будет схема `monitoring` — этап Э2 плана `docs/plans/monitoring.html`.',
        )
        .height(4)
        .span(24),
    )
    .build();
}
