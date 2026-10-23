import { crearApp } from './app.js';
import { cargarConfig } from './config.js';
import { crearPool } from './db/pool.js';

const config = cargarConfig();
const pool = crearPool({ databaseUrl: config.databaseUrl, max: config.apiPoolSize, applicationName: 'ledger-api' });
const app = crearApp({ config, pool });

// Cola de conexiones pendientes del socket: con 7000 requests simultáneas el default (511) no alcanza.
await app.listen({ port: config.port, host: config.host, backlog: 8192 });

async function apagar(senal) {
  app.log.info({ senal }, 'apagando');
  await app.close();
  await pool.end();
  process.exit(0);
}
process.on('SIGTERM', () => apagar('SIGTERM'));
process.on('SIGINT', () => apagar('SIGINT'));
