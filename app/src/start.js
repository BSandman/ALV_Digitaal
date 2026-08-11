import { loadRuntimeConfiguration } from './config/secrets-file.js';

export async function bootstrap() {
  await loadRuntimeConfiguration();
  const { startServer } = await import('./server.js');
  return startServer();
}

// LiteSpeed lsnode laadt het ingestelde startupbestand synchroon via require().
// Houd daarom de statische modulegraph vrij van top-level await; asynchroon
// configureren en starten gebeurt pas binnen deze onmiddellijk gestarte promise.
export const startupPromise = bootstrap();
startupPromise.catch((error) => {
  console.error('[alv-app] startup mislukt:', error);
  process.exitCode = 1;
});
