import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { crearApp } from '../../src/app.js';
import { crearPool } from '../../src/db/pool.js';
import { cargarEnv } from '../../src/config.js';

cargarEnv();

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/ledger';
const WEBHOOK_SECRET = 'secreto-regression';
const API_KEY = 'mk_regression';
const MERCHANT_ID = 'm_regression';

function firmar(ts, body) {
  return `v1=${createHmac('sha256', WEBHOOK_SECRET).update(`${ts}.${body}`).digest('hex')}`;
}

describe('Regresión - casos críticos', () => {
  let pool;
  let app;

  before(async () => {
    pool = crearPool({ databaseUrl: DATABASE_URL, max: 10, applicationName: 'test-regression' });
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
      [MERCHANT_ID, 'Regresion', hashApiKey(API_KEY)],
    );
  });

  after(async () => {
    await app.close();
    await pool.end();
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
      headers: { 'x-psp-timestamp': String(ts), 'x-psp-signature': firmar(ts, body) },
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
