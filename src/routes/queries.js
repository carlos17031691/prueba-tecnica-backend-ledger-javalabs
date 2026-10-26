import { crearAutenticadorComercio } from '../auth/middleware.js';
import { formatearMonto } from '../domain/money.js';

export async function rutasConsultas(app, { pool }) {
  const autenticarComercio = crearAutenticadorComercio(pool);

  // 1. GET /merchants/me/balance
  app.get('/merchants/me/balance', { preHandler: autenticarComercio }, async (req, reply) => {
    const merchantId = req.merchant.id;

    const { rows } = await pool.query(
      `SELECT
         COALESCE(SUM(amount_cents), 0) AS balance_cents,
         MAX(created_at) AS last_movement_at
       FROM ledger_movements
       WHERE merchant_id = $1`,
      [merchantId],
    );

    const available = formatearMonto(rows[0].balance_cents);
    const lastMovementAt = rows[0].last_movement_at
      ? new Date(rows[0].last_movement_at).toISOString()
      : null;

    return reply.send({
      available,
      last_movement_at: lastMovementAt,
    });
  });

  // 2. GET /merchants/me/movements (paginado por cursor, más nuevos primero)
  app.get('/merchants/me/movements', { preHandler: autenticarComercio }, async (req, reply) => {
    const merchantId = req.merchant.id;

    let limit = 20;
    if (req.query.limit !== undefined) {
      if (!/^\d+$/.test(req.query.limit)) {
        return reply.code(400).send({ error: 'bad_request', message: 'Parámetro limit inválido' });
      }
      limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10), 1), 100);
    }
    
    let cursor = null;
    if (req.query.cursor) {
      cursor = Buffer.from(req.query.cursor, 'base64').toString('utf8');
      if (!/^\d+$/.test(cursor)) {
        return reply.code(400).send({ error: 'bad_request', message: 'Cursor inválido' });
      }
    }

    let query = `
      SELECT id, kind, transaction_id, event_id, gross_cents, fee_cents, amount_cents, created_at
      FROM ledger_movements
      WHERE merchant_id = $1
    `;
    const params = [merchantId];

    if (cursor) {
      params.push(cursor);
      query += ` AND id < $${params.length}`;
    }

    params.push(limit + 1);
    query += ` ORDER BY id DESC LIMIT $${params.length}`;

    const { rows } = await pool.query(query, params);
    const tieneMas = rows.length > limit;
    const items = tieneMas ? rows.slice(0, limit) : rows;

    const formattedItems = items.map((m) => ({
      id: m.id,
      kind: m.kind,
      transaction_id: m.transaction_id,
      event_id: m.event_id,
      gross: formatearMonto(m.gross_cents),
      fee: formatearMonto(m.fee_cents),
      amount: formatearMonto(m.amount_cents),
      created_at: new Date(m.created_at).toISOString(),
    }));

    const siguienteCursor = tieneMas
      ? Buffer.from(items[items.length - 1].id).toString('base64')
      : null;

    return reply.send({
      items: formattedItems,
      next_cursor: siguienteCursor,
    });
  });

  // 3. GET /transactions/:id
  app.get('/transactions/:id', { preHandler: autenticarComercio }, async (req, reply) => {
    const merchantId = req.merchant.id;
    const txId = req.params.id;

    // Obtener la transacción solo si pertenece al comercio
    const txRes = await pool.query(
      `SELECT id, amount_cents, currency, status, created_at, updated_at
       FROM transactions
       WHERE id = $1 AND merchant_id = $2`,
      [txId, merchantId],
    );

    if (txRes.rows.length === 0) {
      return reply.code(404).send({ error: 'not_found', message: 'Transacción no encontrada' });
    }

    const tx = txRes.rows[0];

    // Obtener eventos asociados recibidos
    const eventsRes = await pool.query(
      `SELECT event_id, type, occurred_at, status, received_at
       FROM inbox_events
       WHERE transaction_id = $1 AND merchant_id = $2
       ORDER BY received_at ASC`,
      [txId, merchantId],
    );

    return reply.send({
      id: tx.id,
      status: tx.status,
      amount: formatearMonto(tx.amount_cents),
      currency: tx.currency,
      events: eventsRes.rows.map((e) => ({
        event_id: e.event_id,
        type: e.type,
        occurred_at: new Date(e.occurred_at).toISOString(),
        status: e.status,
        received_at: new Date(e.received_at).toISOString(),
      })),
    });
  });
}
