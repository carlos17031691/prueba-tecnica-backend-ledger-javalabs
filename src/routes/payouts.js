import { createHash, randomUUID } from 'node:crypto';
import { crearAutenticadorComercio } from '../auth/middleware.js';
import { enTransaccion } from '../db/pool.js';
import { formatearMonto, parsearMonto } from '../domain/money.js';

export async function rutasPayouts(app, { pool }) {
  const autenticarComercio = crearAutenticadorComercio(pool);

  // B1: POST /payouts con Idempotency-Key
  app.post('/payouts', { preHandler: autenticarComercio }, async (req, reply) => {
    const idempotencyKey = req.headers['idempotency-key'];
    if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.trim() === '') {
      return reply.code(400).send({ error: 'bad_request', message: 'Header Idempotency-Key requerido' });
    }

    const merchantId = req.merchant.id;
    const body = req.body;

    if (!body || typeof body !== 'object' || body.amount === undefined || body.amount === null) {
      return reply.code(400).send({ error: 'bad_request', message: 'Campo amount requerido' });
    }
    if (typeof body.amount !== 'string') {
      return reply.code(400).send({ error: 'bad_request', message: 'Formato de amount inválido o menor a 0' });
    }

    let amountCents;
    try {
      amountCents = parsearMonto(body.amount);
      if (amountCents <= 0n) throw new Error();
    } catch {
      return reply.code(400).send({ error: 'bad_request', message: 'Formato de amount inválido o menor a 0' });
    }

    // Hash canónico para detectar cambios de payload con misma idempotency key
    const requestHash = createHash('sha256').update(JSON.stringify({ amount: body.amount })).digest('hex');

    // Procesamiento atómico en DB
    const resultado = await enTransaccion(pool, async (client) => {
      // 1. Lock transaccional sobre la clave de idempotencia para serializar llamadas concurrentes idénticas
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`payout_${merchantId}_${idempotencyKey}`]);

      // 2. Verificar idempotencia previa
      const payoutPrevio = await client.query(
        `SELECT id, request_hash, response_body
         FROM payouts
         WHERE merchant_id = $1 AND idempotency_key = $2`,
        [merchantId, idempotencyKey],
      );

      if (payoutPrevio.rows.length > 0) {
        const existente = payoutPrevio.rows[0];
        if (existente.request_hash !== requestHash) {
          // Misma key con body distinto -> 409 Conflict
          return { status: 409, body: { error: 'conflict', message: 'Idempotency key ya utilizada con otro payload' } };
        }
        // Misma key con mismo payload -> devolver respuesta original
        return { status: 200, body: existente.response_body };
      }

      // 3. Lock del comercio para serializar payouts y proteger concurrencia de saldo
      // NO KEY UPDATE: mismo lock que usan las reversas, sin chocar con los KEY SHARE de las FK.
      await client.query('SELECT id FROM merchants WHERE id = $1 FOR NO KEY UPDATE', [merchantId]);

      // 3. Calcular saldo actual del comercio
      const saldoRes = await client.query(
        `SELECT COALESCE(SUM(amount_cents), 0) AS balance_cents
         FROM ledger_movements
         WHERE merchant_id = $1`,
        [merchantId],
      );
      const saldoActual = BigInt(saldoRes.rows[0].balance_cents);

      if (saldoActual < amountCents) {
        // Saldo insuficiente -> 422
        return {
          status: 422,
          body: {
            error: 'unprocessable_entity',
            message: 'Saldo insuficiente',
            available: formatearMonto(saldoActual),
          },
        };
      }

      // 4. Crear payout y movimiento de ledger correspondiente
      const payoutId = `po_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
      const montoDebito = -amountCents;

      const responseBody = {
        id: payoutId,
        merchant_id: merchantId,
        amount: formatearMonto(amountCents),
        created_at: new Date().toISOString(),
      };

      await client.query(
        `INSERT INTO payouts (id, merchant_id, idempotency_key, request_hash, amount_cents, response_body)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [payoutId, merchantId, idempotencyKey, requestHash, amountCents.toString(), responseBody],
      );

      await client.query(
        `INSERT INTO ledger_movements
           (merchant_id, kind, transaction_id, payout_id, gross_cents, fee_cents, amount_cents)
         VALUES ($1, 'payout', NULL, $2, $3, 0, $4)`,
        [merchantId, payoutId, amountCents.toString(), montoDebito.toString()],
      );

      return { status: 201, body: responseBody };
    });

    return reply.code(resultado.status).send(resultado.body);
  });
}
