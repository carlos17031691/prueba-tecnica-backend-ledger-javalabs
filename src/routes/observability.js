import { createHash, timingSafeEqual } from 'node:crypto';
import { enTransaccion } from '../db/pool.js';
import { procesarEventoEnTx } from '../domain/eventProcessor.js';

export async function rutasOperacion(app, { config, pool }) {
  // 1. GET /health: verifica estado de la DB
  app.get('/health', async (_req, reply) => {
    try {
      await pool.query('SELECT 1');
      return reply.send({ status: 'ok', db: 'connected', timestamp: new Date().toISOString() });
    } catch (err) {
      return reply.code(503).send({ status: 'error', db: 'disconnected', error: err.message });
    }
  });

  // 2. GET /metrics: eventos procesados, duplicados, diferidos, fallidos, etc.
  app.get('/metrics', async (_req, reply) => {
    try {
      const statsRes = await pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'received') as received,
          COUNT(*) FILTER (WHERE status = 'processed') as processed,
          COUNT(*) FILTER (WHERE status = 'deferred') as deferred,
          COUNT(*) FILTER (WHERE status = 'invalid') as invalid,
          COUNT(*) FILTER (WHERE status = 'failed') as failed,
          COALESCE(SUM(duplicate_count), 0) as total_duplicates,
          COUNT(*) as total_events
        FROM inbox_events
      `);

      return reply.send({
        events: {
          received: Number(statsRes.rows[0].received),
          processed: Number(statsRes.rows[0].processed),
          deferred: Number(statsRes.rows[0].deferred),
          invalid: Number(statsRes.rows[0].invalid),
          failed: Number(statsRes.rows[0].failed),
          total_duplicates: Number(statsRes.rows[0].total_duplicates),
          total: Number(statsRes.rows[0].total_events),
        },
        uptime_seconds: Math.floor(process.uptime()),
      });
    } catch (err) {
      return reply.code(500).send({ error: 'metrics_unavailable', details: err.message });
    }
  });

  // 3. POST /admin/events/:id/reprocess: reprocesa evento fallido
  app.post('/admin/events/:id/reprocess', async (req, reply) => {
    const adminToken = req.headers['x-admin-token'];
    
    // Comparación segura en tiempo constante para mitigar timing attacks
    const tokenValido = (() => {
      if (!config.adminToken || typeof adminToken !== 'string') return false;
      const hashEsperado = createHash('sha256').update(config.adminToken).digest();
      const hashRecibido = createHash('sha256').update(adminToken).digest();
      return timingSafeEqual(hashEsperado, hashRecibido);
    })();

    if (!tokenValido) {
      return reply.code(401).send({ error: 'unauthorized', message: 'Token de administrador inválido' });
    }

    const eventId = req.params.id;

    const res = await enTransaccion(pool, async (client) => {
      const evRes = await client.query(
        `SELECT event_id, type, transaction_id, merchant_id, amount_cents, currency, status
         FROM inbox_events
         WHERE event_id = $1
         FOR UPDATE`,
        [eventId],
      );

      if (evRes.rows.length === 0) {
        return { status: 404, body: { error: 'not_found', message: 'Evento no encontrado' } };
      }

      const evento = evRes.rows[0];
      if (evento.status !== 'failed') {
        return {
          status: 400,
          body: { error: 'bad_request', message: `Solo eventos con estado 'failed' pueden ser reprocesados (estado actual: ${evento.status})` },
        };
      }

      const resultado = await procesarEventoEnTx(client, evento);
      return { status: 200, body: { reprocessed: true, result: resultado } };
    });

    return reply.code(res.status).send(res.body);
  });
}
