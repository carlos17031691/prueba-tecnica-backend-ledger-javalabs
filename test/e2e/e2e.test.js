import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { crearHarness } from '../../test-support/harness.js';
import { enTransaccion } from '../../src/db/pool.js';
import { procesarEventoEnTx } from '../../src/domain/eventProcessor.js';
import { tomarYProcesarSiguiente } from '../../src/worker.js';

const WEBHOOK_SECRET = 'secreto-e2e';
const API_KEY = 'mk_e2e';
const MERCHANT_ID = 'm_e2e';

describe('E2E - flujo completo', () => {
  let harness;
  let pool;
  let app;
  let enviarWebhook;

  before(async () => {
    harness = await crearHarness({
      applicationName: 'test-e2e',
      merchantId: MERCHANT_ID,
      merchantName: 'E2E',
      apiKey: API_KEY,
      webhookSecret: WEBHOOK_SECRET,
      max: 15,
    });
    ({ pool, app, enviarWebhook } = harness);
  });

  after(async () => {
    await harness.cerrar();
  });

  async function drenarCola(maxIter = 200) {
    for (let i = 0; i < maxIter; i++) {
      const hubo = await tomarYProcesarSiguiente(pool, { workerMaxIntentos: 5 });
      if (!hubo) break;
    }
  }

  // El worker de producción puede estar corriendo en paralelo: se espera a que
  // el estado converja en vez de asumir que el procesamiento es inmediato.
  async function esperar(condicion, timeoutMs = 5000) {
    const limite = Date.now() + timeoutMs;
    while (Date.now() < limite) {
      if (await condicion()) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return condicion();
  }

  async function saldoDisponible() {
    const res = await app.inject({ method: 'GET', url: '/merchants/me/balance', headers: { 'x-api-key': API_KEY } });
    return JSON.parse(res.payload).available;
  }

  async function estadoTransaccion(txId) {
    const res = await app.inject({ method: 'GET', url: `/transactions/${txId}`, headers: { 'x-api-key': API_KEY } });
    if (res.statusCode === 404) return 404;
    return JSON.parse(res.payload).status;
  }

  // El sufijo del event_id sale del tipo: created -> c, approved -> a, reversed -> r.
  const evento = (txId, tipo, amount, currency = 'ARS') => ({
    event_id: `evt_${txId}_${tipo.split('.')[1][0]}`,
    type: tipo,
    occurred_at: new Date().toISOString(),
    data: { transaction_id: txId, merchant_id: MERCHANT_ID, amount, currency },
  });

  test('E2E-001: created + approved acredita neto (2.5%)', async () => {
    const saldoAntes = Number(await saldoDisponible());

    const txId = `tx_e2e_${Date.now()}_1`;
    assert.equal((await enviarWebhook(evento(txId, 'payment.created', '1000.00'))).statusCode, 200);
    assert.equal((await enviarWebhook(evento(txId, 'payment.approved', '1000.00'))).statusCode, 200);
    await drenarCola();

    // 1000.00 - 2.5% = 975.00
    const acreditado = await esperar(async () => Number(await saldoDisponible()) - saldoAntes === 975);
    assert.equal(acreditado, true);
    assert.equal(Number(await saldoDisponible()) - saldoAntes, 975);
  });

  test('E2E-002: idempotencia de duplicados', async () => {
    const txId = `tx_e2e_${Date.now()}_2`;
    const evt = evento(txId, 'payment.created', '500.00');
    const r1 = await enviarWebhook(evt);
    const r2 = await enviarWebhook(evt);
    assert.equal(r1.statusCode, 200);
    assert.equal(r2.statusCode, 200);
    assert.equal(JSON.parse(r1.payload).duplicate, false);
    assert.equal(JSON.parse(r2.payload).duplicate, true);
  });

  test('E2E-003: reversed antes de approved -> neto cero', async () => {
    const txId = `tx_e2e_${Date.now()}_3`;
    assert.equal((await enviarWebhook(evento(txId, 'payment.created', '200.00'))).statusCode, 200);
    assert.equal((await enviarWebhook(evento(txId, 'payment.reversed', '200.00'))).statusCode, 200);
    assert.equal((await enviarWebhook(evento(txId, 'payment.approved', '200.00'))).statusCode, 200);
    await drenarCola();

    assert.equal(await esperar(async () => (await estadoTransaccion(txId)) === 'reversed'), true);
  });

  test('E2E-004: evento USD no genera movimiento', async () => {
    const saldoAntes = await saldoDisponible();
    const txId = `tx_e2e_${Date.now()}_4`;
    assert.equal((await enviarWebhook(evento(txId, 'payment.created', '100.00', 'USD'))).statusCode, 200);
    assert.equal((await enviarWebhook(evento(txId, 'payment.approved', '100.00', 'USD'))).statusCode, 200);
    await drenarCola();

    assert.equal(await esperar(async () => (await estadoTransaccion(txId)) === 'approved'), true);
    assert.equal(await saldoDisponible(), saldoAntes);
  });

  test('E2E-005: payout exitoso', async () => {
    const txId = `tx_e2e_${Date.now()}_5`;
    const evCId = `evt_${txId}_c`;
    const evAId = `evt_${txId}_a`;

    // next_attempt_at en el futuro: el worker de fondo no compite por estos eventos,
    // la prueba los procesa explícitamente en su propia transacción.
    await pool.query(
      `INSERT INTO inbox_events
         (event_id, type, transaction_id, merchant_id, amount_cents, currency, occurred_at, payload, payload_hash, next_attempt_at)
       VALUES ($1, 'payment.created', $2, $3, '50000', 'ARS', clock_timestamp(), '{}', 'h1', clock_timestamp() + interval '1 hour'),
              ($4, 'payment.approved', $2, $3, '50000', 'ARS', clock_timestamp(), '{}', 'h2', clock_timestamp() + interval '1 hour')`,
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
