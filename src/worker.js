import { cargarConfig } from './config.js';
import { crearPool, enTransaccion } from './db/pool.js';
import { procesarEventoEnTx } from './domain/eventProcessor.js';

const config = cargarConfig();
const pool = crearPool({
  databaseUrl: config.databaseUrl,
  max: config.workerPoolSize,
  applicationName: 'ledger-worker',
});

let corriendo = true;

async function tomarYProcesarSiguiente() {
  return enTransaccion(pool, async (client) => {
    // Tomar 1 evento pendiente usando SKIP LOCKED para evitar colisiones entre workers
    const res = await client.query(`
      SELECT event_id, type, transaction_id, merchant_id, amount_cents, currency, attempts
      FROM inbox_events
      WHERE status = 'received' AND next_attempt_at <= clock_timestamp()
      ORDER BY next_attempt_at ASC, received_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `);

    if (res.rows.length === 0) return false;

    const evento = res.rows[0];

    try {
      await procesarEventoEnTx(client, evento);
      return true;
    } catch (err) {
      const intentos = evento.attempts + 1;
      const fallido = intentos >= config.workerMaxIntentos;
      const estado = fallido ? 'failed' : 'received';
      // Backoff simple para reintentos
      const delaySeg = Math.min(2 ** intentos, 60);

      await client.query(
        `UPDATE inbox_events
         SET status = $1,
             attempts = $2,
             reason = $3,
             next_attempt_at = clock_timestamp() + ($4 || ' seconds')::interval
         WHERE event_id = $5`,
        [estado, intentos, err.message, delaySeg, evento.event_id],
      );
      return true;
    }
  });
}

async function loopWorker(id) {
  while (corriendo) {
    try {
      const huboTrabajo = await tomarYProcesarSiguiente();
      if (!huboTrabajo) {
        // Pausa breve si no hay eventos
        await new Promise((r) => setTimeout(r, 200));
      }
    } catch (err) {
      console.error(`[Worker ${id}] Error:`, err.message);
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

console.log(`Iniciando worker con concurrencia ${config.workerConcurrencia}...`);
for (let i = 0; i < config.workerConcurrencia; i++) {
  loopWorker(i);
}

async function apagar() {
  console.log('Apagando workers...');
  corriendo = false;
  await pool.end();
  process.exit(0);
}

process.on('SIGTERM', apagar);
process.on('SIGINT', apagar);
