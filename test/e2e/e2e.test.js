import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { crearApp } from '../../src/app.js';
import { crearPool, enTransaccion } from '../../src/db/pool.js';
import { procesarEventoEnTx } from '../../src/domain/eventProcessor.js';
import { tomarYProcesarSiguiente } from '../../src/worker.js';
import { cargarEnv } from '../../src/config.js';

cargarEnv();

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/ledger';
const WEBHOOK_SECRET = 'secreto-e2e';
const API_KEY = 'mk_e2e';
const MERCHANT_ID = 'm_e2e';

function firmar(ts, body) {
  return `v1=${createHmac('sha256', WEBHOOK_SECRET).update(`${ts}.${body}`).digest('hex')}`;
}

describe('E2E - flujo completo', () => {
  let pool;
  let app;

  before(async () => {
    pool = crearPool({ databaseUrl: DATABASE_URL, max: 15, applicationName: 'test-e2e' });
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

    const { hashApiKey } = await import('../../src/auth/apiKey.js');
    await pool.query(
      `INSERT INTO merchants (id, name, api_key_hash, commission_bps)
       VALUES ($1, $2, $3, 250)
       ON CONFLICT (id) DO UPDATE
         SET api_key_hash = EXCLUDED.api_key_hash`,
      [MERCHANT_ID, 'E2E', hashApiKey(API_KEY)],
    );
  });

  after(async () => {
    await app.close();
    await pool.end();
  });

  async function enviarWebhook(evento) {
    const ts = Math.floor(Date.now() / 1000);
    const rawBody = JSON.stringify(evento);
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/psp',
      headers: {
        'content-type': 'application/json',
        'x-psp-timestamp': String(ts),
        'x-psp-signature': firmar(ts, rawBody),
      },
      payload: Buffer.from(rawBody),
    });
    return res;
  }

  async function drenarCola(maxIter = 200) {
    for (let i = 0; i < maxIter; i++) {
      const hubo = await tomarYProcesarSiguiente(pool, { workerMaxIntentos: 5 });
      if (!hubo) break;
    }
  }

  test('E2E-001: created + approved acredita neto (2.5%)', async () => {
    const txId = `tx_e2e_${Date.now()}_1`;
    const evt1 = {
      event_id: `evt_${txId}_c`,
      type: 'payment.created',
      occurred_at: new Date().toISOString(),
      data: { transaction_id: txId, merchant_id: MERCHANT_ID, amount: '1000.00', currency: 'ARS' },
    };
    const evt2 = {
      event_id: `evt_${txId}_a`,
      type: 'payment.approved',
      occurred_at: new Date().toISOString(),
      data: { transaction_id: txId, merchant_id: MERCHANT_ID, amount: '1000.00', currency: 'ARS' },
    };

    assert.equal((await enviarWebhook(evt1)).statusCode, 200);
    assert.equal((await enviarWebhook(evt2)).statusCode, 200);
    await drenarCola();

    const bal = await app.inject({ method: 'GET', url: '/merchants/me/balance', headers: { 'x-api-key': API_KEY } });
    const json = JSON.parse(bal.payload);
    // 1000.00 - 2.5% = 975.00
    assert.equal(json.available, '975.00');
  });

  test('E2E-002: idempotencia de duplicados', async () => {
    const txId = `tx_e2e_${Date.now()}_2`;
    const evt = {
      event_id: `evt_${txId}_dup`,
      type: 'payment.created',
      occurred_at: new Date().toISOString(),
      data: { transaction_id: txId, merchant_id: MERCHANT_ID, amount: '500.00', currency: 'ARS' },
    };
    const r1 = await enviarWebhook(evt);
    const r2 = await enviarWebhook(evt);
    assert.equal(r1.statusCode, 200);
    assert.equal(r2.statusCode, 200);
    assert.equal(JSON.parse(r1.payload).duplicate, false);
    assert.equal(JSON.parse(r2.payload).duplicate, true);
  });

  test('E2E-003: reversed antes de approved -> neto cero', async () => {
    const txId = `tx_e2e_${Date.now()}_3`;
    const evtC = {
      event_id: `evt_${txId}_c`,
      type: 'payment.created',
      occurred_at: new Date().toISOString(),
      data: { transaction_id: txId, merchant_id: MERCHANT_ID, amount: '200.00', currency: 'ARS' },
    };
    const evtR = {
      event_id: `evt_${txId}_r`,
      type: 'payment.reversed',
      occurred_at: new Date().toISOString(),
      data: { transaction_id: txId, merchant_id: MERCHANT_ID, amount: '200.00', currency: 'ARS' },
    };
    const evtA = {
      event_id: `evt_${txId}_a`,
      type: 'payment.approved',
      occurred_at: new Date().toISOString(),
      data: { transaction_id: txId, merchant_id: MERCHANT_ID, amount: '200.00', currency: 'ARS' },
    };

    assert.equal((await enviarWebhook(evtC)).statusCode, 200);
    assert.equal((await enviarWebhook(evtR)).statusCode, 200);
    assert.equal((await enviarWebhook(evtA)).statusCode, 200);
    await drenarCola();

    const txRes = await app.inject({ method: 'GET', url: `/transactions/${txId}`, headers: { 'x-api-key': API_KEY } });
    assert.equal(txRes.statusCode, 200);
    const txJson = JSON.parse(txRes.payload);
    assert.equal(txJson.status, 'reversed');
  });

  test('E2E-004: evento USD no genera movimiento', async () => {
    const balAntes = JSON.parse((await app.inject({ method: 'GET', url: '/merchants/me/balance', headers: { 'x-api-key': API_KEY } })).payload);
    const txId = `tx_e2e_${Date.now()}_4`;
    const evtC = {
      event_id: `evt_${txId}_c`,
      type: 'payment.created',
      occurred_at: new Date().toISOString(),
      data: { transaction_id: txId, merchant_id: MERCHANT_ID, amount: '100.00', currency: 'USD' },
    };
    const evtA = {
      event_id: `evt_${txId}_a`,
      type: 'payment.approved',
      occurred_at: new Date().toISOString(),
      data: { transaction_id: txId, merchant_id: MERCHANT_ID, amount: '100.00', currency: 'USD' },
    };
    assert.equal((await enviarWebhook(evtC)).statusCode, 200);
    assert.equal((await enviarWebhook(evtA)).statusCode, 200);
    await drenarCola();

    const balDespues = JSON.parse((await app.inject({ method: 'GET', url: '/merchants/me/balance', headers: { 'x-api-key': API_KEY } })).payload);
    assert.equal(balDespues.available, balAntes.available);
  });

  test('E2E-005: payout exitoso', async () => {
    const txId = `tx_e2e_${Date.now()}_5`;
    const evCId = `evt_${txId}_c`;
    const evAId = `evt_${txId}_a`;

    await pool.query(
      `INSERT INTO inbox_events
         (event_id, type, transaction_id, merchant_id, amount_cents, currency, occurred_at, payload, payload_hash)
       VALUES ($1, 'payment.created', $2, $3, '50000', 'ARS', clock_timestamp(), '{}', 'h1'),
              ($4, 'payment.approved', $2, $3, '50000', 'ARS', clock_timestamp(), '{}', 'h2')`,
      [evCId, txId, MERCHANT_ID, evAId],
    );

    await enTransaccion(pool, async (client) => {
      await procesarEventoEnTx(client, { event_id: evCId, type: 'payment.created', transaction_id: txId, merchant_id: MERCHANT_ID, amount_cents: 50000n, currency: 'ARS' });
      await procesarEventoEnTx(client, { event_id: evAId, type: 'payment.approved', transaction_id: txId, merchant_id: MERCHANT_ID, amount_cents: 50000n, currency: 'ARS' });
    });

    const res = await app.inject({
      method: 'POST',
      url: '/payouts',
      headers: { 'x-api-key': API_KEY, 'idempotency-key': `k_${Date.now()}`, 'content-type': 'application/json' },
      payload: { amount: '10.00' },
    });
    assert.equal(res.statusCode, 201);
  });
});
