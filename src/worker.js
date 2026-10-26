import { fileURLToPath } from 'node:url';
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

// Logs estructurados en JSON: cada línea incluye correlation_id para poder seguir
// un evento desde el webhook (API) hasta el worker.
function emitirLog(nivel, campos, mensaje) {
  process.stdout.write(
    `${JSON.stringify({ ts: new Date().toISOString(), level: nivel, component: 'worker', msg: mensaje, ...campos })}\n`,
  );
}

export async function tomarYProcesarSiguiente(p = pool, cfg = config) {
  return enTransaccion(p, async (client) => {
    // Tomar 1 evento pendiente usando SKIP LOCKED para evitar colisiones entre workers
    const res = await client.query(`
      SELECT event_id, type, transaction_id, merchant_id, amount_cents, currency, attempts, correlation_id
      FROM inbox_events
      WHERE status = 'received' AND next_attempt_at <= clock_timestamp()
      ORDER BY next_attempt_at ASC, received_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `);

    if (res.rows.length === 0) return false;

    const evento = res.rows[0];
    const contexto = {
      worker_id: cfg.workerId ?? null,
      event_id: evento.event_id,
      correlation_id: evento.correlation_id ?? null,
      transaction_id: evento.transaction_id,
      type: evento.type,
    };

    try {
      // SAVEPOINT para aislar fallos de procesamiento y evitar abortar la transacción externa
      await client.query('SAVEPOINT evento_sp');
      try {
        const resultado = await procesarEventoEnTx(client, evento);
        await client.query('RELEASE SAVEPOINT evento_sp');
        emitirLog('info', { ...contexto, status: resultado.estadoFinal, motivo: resultado.motivo ?? null }, 'evento_procesado');
        return true;
      } catch (err) {
        await client.query('ROLLBACK TO SAVEPOINT evento_sp');
        throw err;
      }
    } catch (err) {
      const intentosPrevios = Number(evento.attempts ?? 0);
      const intentos = intentosPrevios + 1;
      const maxIntentos = Number(cfg.workerMaxIntentos ?? 5);
      const fallido = intentos >= maxIntentos;
      const estado = fallido ? 'failed' : 'received';
      // Backoff simple para reintentos
      const delaySeg = Math.min(2 ** intentos, 60);
      const razon = err?.message ? String(err.message).slice(0, 500) : 'unknown_error';

      await client.query(
        `UPDATE inbox_events
         SET status = $1,
             attempts = $2,
             reason = $3,
             next_attempt_at = clock_timestamp() + ($4 || ' seconds')::interval
         WHERE event_id = $5`,
        [estado, intentos, razon, delaySeg, evento.event_id],
      );

      emitirLog(
        'error',
        { ...contexto, status: estado, attempts: intentos, max_attempts: maxIntentos, next_attempt_in_seconds: delaySeg, reason: razon },
        'evento_fallido',
      );
      return true;
    }
  });
}

async function loopWorker(id) {
  const cfg = { ...config, workerId: id };
  while (corriendo) {
    try {
      const huboTrabajo = await tomarYProcesarSiguiente(pool, cfg);
      if (!huboTrabajo) {
        // Pausa breve si no hay eventos
        await new Promise((r) => setTimeout(r, 20));
      }
    } catch (err) {
      emitirLog('error', { worker_id: id, reason: String(err?.message ?? err) }, 'error_de_loop');
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

async function apagar() {
  emitirLog('info', {}, 'worker_apagando');
  corriendo = false;
  await pool.end();
  process.exit(0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  emitirLog('info', { concurrency: config.workerConcurrencia }, 'worker_iniciado');
  for (let i = 0; i < config.workerConcurrencia; i++) {
    void loopWorker(i);
  }
  process.on('SIGTERM', () => { void apagar(); });
  process.on('SIGINT', () => { void apagar(); });
}
