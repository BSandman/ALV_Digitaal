import { loadRuntimeConfiguration } from './config/secrets-file.js';

await loadRuntimeConfiguration();
const { startServer } = await import('./server.js');
startServer();
