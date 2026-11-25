/**
 * Схема `monitoring`: представления, которые читает Grafana (docs/plans/monitoring.html). Имена с
 * приставкой: в схеме `public` есть свои `sources`.
 */
export {
  EVENT_KINDS,
  events as monitoringEvents,
  monitoring,
  sources as monitoringSources,
} from './monitoring.ts';
