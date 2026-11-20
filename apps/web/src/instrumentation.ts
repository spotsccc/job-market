export async function register(): Promise<void> {
  // pino и OpenTelemetry SDK работают только в Node.js — в edge-сборку их не тянем.
  if (process.env['NEXT_RUNTIME'] !== 'nodejs') return;
  const { registerRequestLogging } = await import('./request-logging.ts');
  registerRequestLogging();
}
