import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { crearHarness, firmar } from '../../test-support/harness.js';

const WEBHOOK_SECRET = 'secreto-regression';
const API_KEY = 'mk_regression';
const MERCHANT_ID = 'm_regression';

describe('Regresión - casos críticos', () => {
  let harness;
  let app;

  before(async () => {
    harness = await crearHarness({
      applicationName: 'test-regression',
      merchantId: MERCHANT_ID,
      merchantName: 'Regresion',
      apiKey: API_KEY,
      webhookSecret: WEBHOOK_SECRET,
      max: 10,
    });
    app = harness.app;
  });

  after(async () => {
    await harness.cerrar();
  });

  test('REG-001: webhook con firma inválida -> 401', async () => {
    const ts = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({ event_id: 'x' });
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/psp',
      headers: { 'x-psp-timestamp': String(ts), 'x-psp-signature': 'v1=' + 'a'.repeat(64) },
      payload: Buffer.from(body),
    });
    assert.equal(res.statusCode, 401);
  });

  test('REG-002: timestamp viejo -> 401', async () => {
    const ts = Math.floor(Date.now() / 1000) - 600;
    const body = JSON.stringify({ event_id: 'x2' });
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/psp',
      headers: { 'x-psp-timestamp': String(ts), 'x-psp-signature': firmar(WEBHOOK_SECRET, ts, body) },
      payload: Buffer.from(body),
    });
    assert.equal(res.statusCode, 401);
  });

  test('REG-003: API key inválida -> 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/merchants/me/balance', headers: { 'x-api-key': 'bad' } });
    assert.equal(res.statusCode, 401);
  });

  test('REG-004: transacción ajena -> 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/transactions/tx_inexistente_xyz', headers: { 'x-api-key': API_KEY } });
    assert.equal(res.statusCode, 404);
  });

  test('REG-005: movimientos con limit inválido -> 400', async () => {
    const res = await app.inject({ method: 'GET', url: '/merchants/me/movements?limit=abc', headers: { 'x-api-key': API_KEY } });
    assert.equal(res.statusCode, 400);
  });

  test('REG-006: payouts sin Idempotency-Key -> 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/payouts',
      headers: { 'x-api-key': API_KEY, 'content-type': 'application/json' },
      payload: { amount: '10.00' },
    });
    assert.equal(res.statusCode, 400);
  });
});
