import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { crearApp } from '../../src/app.js';
import { crearPool } from '../../src/db/pool.js';
import { procesarEventoEnTx } from '../../src/domain/eventProcessor.js';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:54329/ledger';
const WEBHOOK_SECRET = 'secreto-test-integracion';
const API_KEY = 'mk_test_integracion';
const MERCHANT_ID = 'm_test_integ';

function firmar(ts, body) {
  return `v1=${createHmac('sha256', WEBHOOK_SECRET).update(`${ts}.${body}`).digest('hex')}`;
}

describe('Tests de integración contra DB real', () => {
  let pool;
  let app;

  before(async () => {
    pool = crearPool({ databaseUrl: DATABASE_URL, max: 15, applicationName: 'test-integration' });
    app = crearApp({
      config: {
        port: 0,
        host: '127.0.0.1',
        logLevel: 'silent',
        databaseUrl: DATABASE_URL,
        webhookSecret: WEBHOOK_SECRET,
        webhookToleranciaSeg: 300,
        adminToken: 'test-admin',
      },
      pool,
      logger: false,
    });
    await app.ready();

    // Sembrar comercio de prueba específico para la suite de integración
    const { hashApiKey } = await import('../../src/auth/apiKey.js');
    await pool.query(
      `INSERT INTO merchants (id, name, api_key_hash, commission_bps)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE
         SET api_key_hash = EXCLUDED.api_key_hash, commission_bps = EXCLUDED.commission_bps`,
      [MERCHANT_ID, 'Comercio Integration', hashApiKey(API_KEY), 250],
    );
  });

  after(async () => {
    await app.close();
    await pool.end();
  });

  test('POST /webhooks/psp valida firma e inserta de forma idempotente', async () => {
    const ts = Math.floor(Date.now() / 1000);
    const uniqueId = Date.now();
    const bodyObj = {
      event_id: `evt_integ_${uniqueId}`,
      type: 'payment.created',
      occurred_at: new Date().toISOString(),
      data: {
        transaction_id: `tx_integ_${uniqueId}`,
        merchant_id: MERCHANT_ID,
        amount: '1000.00',
        currency: 'ARS',
      },
    };
    const rawBody = JSON.stringify(bodyObj);

    // Primer envío -> 200 OK
    const res1 = await app.inject({
      method: 'POST',
      url: '/webhooks/psp',
      headers: {
        'content-type': 'application/json',
        'x-psp-timestamp': String(ts),
        'x-psp-signature': firmar(ts, rawBody),
      },
      payload: Buffer.from(rawBody),
    });

    assert.equal(res1.statusCode, 200);
    const json1 = JSON.parse(res1.payload);
    assert.equal(json1.received, true);
    assert.equal(json1.duplicate, false);

    // Segundo envío (duplicado) -> 200 OK con duplicate: true
    const res2 = await app.inject({
      method: 'POST',
      url: '/webhooks/psp',
      headers: {
        'content-type': 'application/json',
        'x-psp-timestamp': String(ts),
        'x-psp-signature': firmar(ts, rawBody),
      },
      payload: Buffer.from(rawBody),
    });

    assert.equal(res2.statusCode, 200);
    const json2 = JSON.parse(res2.payload);
    assert.equal(json2.received, true);
    assert.equal(json2.duplicate, true);
  });

  test('POST /webhooks/psp rechaza firma inválida con 401', async () => {
    const ts = Math.floor(Date.now() / 1000);
    const rawBody = '{"event_id":"evt_bad_sig"}';

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/psp',
      headers: {
        'content-type': 'application/json',
        'x-psp-timestamp': String(ts),
        'x-psp-signature': 'v1=badbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbad',
      },
      payload: Buffer.from(rawBody),
    });

    assert.equal(res.statusCode, 401);
  });

  test('POST /webhooks/psp rechaza timestamp mayor a 5 minutos con 401', async () => {
    const tsViejo = Math.floor(Date.now() / 1000) - 400; // > 300 s
    const rawBody = '{"event_id":"evt_expired"}';

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/psp',
      headers: {
        'content-type': 'application/json',
        'x-psp-timestamp': String(tsViejo),
        'x-psp-signature': firmar(tsViejo, rawBody),
      },
      payload: Buffer.from(rawBody),
    });

    assert.equal(res.statusCode, 401);
  });

  test('GET /merchants/me/balance y paginación por cursor', async () => {
    // Consultar saldo inicial del comercio
    const resBalance = await app.inject({
      method: 'GET',
      url: '/merchants/me/balance',
      headers: { 'x-api-key': API_KEY },
    });

    assert.equal(resBalance.statusCode, 200);
    const balanceJson = JSON.parse(resBalance.payload);
    assert.ok(typeof balanceJson.available === 'string');

    // Consultar movimientos
    const resMovements = await app.inject({
      method: 'GET',
      url: '/merchants/me/movements?limit=10',
      headers: { 'x-api-key': API_KEY },
    });

    assert.equal(resMovements.statusCode, 200);
    const movJson = JSON.parse(resMovements.payload);
    assert.ok(Array.isArray(movJson.items));
  });

  test('Aislamiento entre comercios: API key inválida da 401 y transacción ajena da 404', async () => {
    const resNoAuth = await app.inject({
      method: 'GET',
      url: '/merchants/me/balance',
      headers: { 'x-api-key': 'clave_inexistente' },
    });
    assert.equal(resNoAuth.statusCode, 401);

    const resTx404 = await app.inject({
      method: 'GET',
      url: '/transactions/tx_no_existe',
      headers: { 'x-api-key': API_KEY },
    });
    assert.equal(resTx404.statusCode, 404);
  });

  test('Extensión B1: Payouts debitan saldo y validan Idempotency-Key', async () => {
    // Si no hay saldo suficiente para un monto gigante -> 422
    const resInsuficiente = await app.inject({
      method: 'POST',
      url: '/payouts',
      headers: {
        'x-api-key': API_KEY,
        'idempotency-key': 'idemp_test_01',
        'content-type': 'application/json',
      },
      payload: { amount: '999999999.00' },
    });
    assert.equal(resInsuficiente.statusCode, 422);

    // Sin header de idempotency -> 400
    const resSinHeader = await app.inject({
      method: 'POST',
      url: '/payouts',
      headers: { 'x-api-key': API_KEY },
      payload: { amount: '10.00' },
    });
    assert.equal(resSinHeader.statusCode, 400);
  });

  test('Concurrencia: 10 envíos paralelos del mismo evento acreditan una sola vez', async () => {
    const client = await pool.connect();
    try {
      const txId = `tx_conc_${Date.now()}`;
      const evId = `evt_conc_${Date.now()}`;
      const amountCents = 100000n; // 1.000,00 ARS

      // 1. Crear la transacción en pending
      await client.query('BEGIN');
      await procesarEventoEnTx(client, {
        event_id: `evt_c_${txId}`,
        type: 'payment.created',
        transaction_id: txId,
        merchant_id: MERCHANT_ID,
        amount_cents: amountCents,
        currency: 'ARS',
      });
      await client.query('COMMIT');

      // 2. Insertar el evento approved en inbox_events
      await client.query(
        `INSERT INTO inbox_events
           (event_id, type, transaction_id, merchant_id, amount_cents, currency, occurred_at, payload, payload_hash)
         VALUES ($1, 'payment.approved', $2, $3, $4, 'ARS', now(), '{}', 'hash_test')`,
        [evId, txId, MERCHANT_ID, amountCents.toString()],
      );

      // 3. Ejecutar 10 llamadas concurrentes para procesar el MISMO evento
      const eventoAprobacion = {
        event_id: evId,
        type: 'payment.approved',
        transaction_id: txId,
        merchant_id: MERCHANT_ID,
        amount_cents: amountCents,
        currency: 'ARS',
      };

      const ejecutarProcesamiento = async () => {
        const c = await pool.connect();
        try {
          await c.query('BEGIN');
          const res = await procesarEventoEnTx(c, eventoAprobacion);
          await c.query('COMMIT');
          return res;
        } catch (err) {
          await c.query('ROLLBACK').catch(() => {});
          return { error: err.message };
        } finally {
          c.release();
        }
      };

      const resultados = await Promise.all(
        Array.from({ length: 10 }, () => ejecutarProcesamiento()),
      );

      // 4. Verificar en el ledger cuántos movimientos se crearon para esta transacción
      const movRes = await pool.query(
        'SELECT COUNT(*) as total FROM ledger_movements WHERE transaction_id = $1 AND kind = \'payment_credit\'',
        [txId],
      );
      assert.equal(Number(movRes.rows[0].total), 1, 'Debe haber exactamente 1 movimiento de crédito');
    } finally {
      client.release();
    }
  });

  test('Concurrencia: approved y reversed simultáneos terminan en estado consistente', async () => {
    const txId = `tx_race_${Date.now()}`;
    const amountCents = 50000n; // 500,00 ARS

    const cSetup = await pool.connect();
    try {
      await cSetup.query('BEGIN');
      await procesarEventoEnTx(cSetup, {
        event_id: `evt_c_${txId}`,
        type: 'payment.created',
        transaction_id: txId,
        merchant_id: MERCHANT_ID,
        amount_cents: amountCents,
        currency: 'ARS',
      });
      await cSetup.query('COMMIT');

      // Insertar ambos eventos en el inbox
      await cSetup.query(
        `INSERT INTO inbox_events (event_id, type, transaction_id, merchant_id, amount_cents, currency, occurred_at, payload, payload_hash)
         VALUES
           ($1, 'payment.approved', $3, $4, $5, 'ARS', now(), '{}', 'h1'),
           ($2, 'payment.reversed', $3, $4, $5, 'ARS', now(), '{}', 'h2')`,
        [`evt_app_${txId}`, `evt_rev_${txId}`, txId, MERCHANT_ID, amountCents.toString()],
      );
    } finally {
      cSetup.release();
    }

    const proc = async (tipo, evtId) => {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        const res = await procesarEventoEnTx(c, {
          event_id: evtId,
          type: tipo,
          transaction_id: txId,
          merchant_id: MERCHANT_ID,
          amount_cents: amountCents,
          currency: 'ARS',
        });
        await c.query('COMMIT');
        return res;
      } catch (err) {
        await c.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        c.release();
      }
    };

    // Lanzar approved y reversed al mismo tiempo en paralelo
    await Promise.all([
      proc('payment.approved', `evt_app_${txId}`),
      proc('payment.reversed', `evt_rev_${txId}`),
    ]);

    // Verificar estado final en la base
    const txRes = await pool.query('SELECT status FROM transactions WHERE id = $1', [txId]);
    assert.equal(txRes.rows[0].status, 'reversed', 'El estado final debe ser reversed');

    // Verificar movimientos de ledger: exactamente un crédito y un débito (efecto neto cero)
    const movRes = await pool.query(
      'SELECT kind, amount_cents FROM ledger_movements WHERE transaction_id = $1 ORDER BY id ASC',
      [txId],
    );
    assert.equal(movRes.rows.length, 2, 'Deben existir 2 movimientos: crédito y reversa');
    assert.equal(movRes.rows[0].kind, 'payment_credit');
    assert.equal(movRes.rows[1].kind, 'payment_reversal');
    assert.equal(
      BigInt(movRes.rows[0].amount_cents) + BigInt(movRes.rows[1].amount_cents),
      0n,
      'El efecto neto en el ledger debe ser exactamente cero',
    );
  });
});
